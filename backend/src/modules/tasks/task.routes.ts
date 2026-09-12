import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { taskService } from './task.service.js';
import { TASK_STATUS_ORDER, type TaskStatus } from '../../models/Task.js';
import {
  booleanQuery,
  commonErrors,
  idParam,
  listEnvelope,
  messageEnvelope,
  objectIdSchema,
  okEnvelope,
  paginationQuery,
} from '../../lib/schemas.js';
import { message, ok, paginated } from '../../lib/response.js';
import { viewerOf } from '../../lib/viewer.js';
import { PERMISSIONS } from '../../config/constants.js';

const security = [{ tenantToken: [] }];

const checklistItem = z.object({
  text: z.string().trim().min(1),
  done: z.boolean().optional(),
});

const taskLabel = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().min(1),
});

const createTaskBody = z.object({
  subject: z.string().trim().min(1, 'Subject is required'),
  description: z.string().trim().optional(),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  status: z.enum(TASK_STATUS_ORDER as [string, ...string[]]).optional(),
  assignedTo: z.array(objectIdSchema).optional(),
  checklist: z.array(checklistItem).optional(),
  labels: z.array(taskLabel).optional(),
  images: z.array(z.string()).optional(),
  leadId: objectIdSchema.optional(),
});

const updateTaskBody = createTaskBody.partial();

const listTasksQuery = paginationQuery.extend({
  status: z.enum(TASK_STATUS_ORDER as [string, ...string[]]).optional(),
  leadId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  bucket: z.enum(['mine', 'assigned']).optional(),
  overdue: booleanQuery.optional(),
  scope: z.enum(['today', 'tomorrow']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().optional(),
});

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/stats/status-counts',
    schema: {
      tags: ['tasks'],
      summary: 'Task counts per status, for the filter tabs',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await taskService.statusCounts(viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(PERMISSIONS.TASKS_VIEW)],
    schema: {
      tags: ['tasks'],
      summary: 'List tasks',
      security,
      querystring: listTasksQuery,
      response: { 200: listEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      const { data, total, page, limit } = await taskService.list(
        request.query,
        viewerOf(request)
      );
      return paginated(data, total, page, limit);
    },
  });

  r.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['tasks'],
      summary: 'Create a task',
      security,
      body: createTaskBody,
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const task = await taskService.create(request.body, viewerOf(request));
      return reply.status(201).send(ok(task));
    },
  });

  r.route({
    method: 'GET',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.TASKS_VIEW)],
    schema: {
      tags: ['tasks'],
      summary: 'Get one task',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await taskService.getById(request.params.id)),
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.TASKS_MANAGE)],
    schema: {
      tags: ['tasks'],
      summary: 'Update a task',
      security,
      params: idParam,
      body: updateTaskBody,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await taskService.update(request.params.id, request.body, viewerOf(request))),
  });

  r.route({
    method: 'PATCH',
    url: '/:id/status',
    schema: {
      tags: ['tasks'],
      summary: 'Move a task to another status',
      security,
      params: idParam,
      body: z.object({ status: z.enum(TASK_STATUS_ORDER as [string, ...string[]]) }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await taskService.setStatus(request.params.id, request.body.status as TaskStatus)),
  });

  r.route({
    method: 'POST',
    url: '/:id/comments',
    schema: {
      tags: ['tasks'],
      summary: 'Post a comment on a task',
      security,
      params: idParam,
      body: z.object({ text: z.string().trim().min(1).max(5000) }),
      response: { 201: okEnvelope, ...commonErrors },
    },
    handler: async (request, reply) => {
      const task = await taskService.addComment(
        request.params.id,
        request.body.text,
        viewerOf(request)
      );
      return reply.status(201).send(ok(task));
    },
  });

  r.route({
    method: 'PATCH',
    url: '/:id/checklist/:itemId',
    schema: {
      tags: ['tasks'],
      summary: 'Toggle a checklist item',
      security,
      params: z.object({ id: objectIdSchema, itemId: objectIdSchema }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await taskService.toggleChecklistItem(request.params.id, request.params.itemId)
      ),
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requirePermission(PERMISSIONS.TASKS_MANAGE)],
    schema: {
      tags: ['tasks'],
      summary: 'Soft-delete a task',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await taskService.remove(request.params.id);
      return message('Task deleted');
    },
  });
}
