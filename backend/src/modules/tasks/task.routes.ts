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

/**
 * Who reaches these routes at all. What each person may do with one task —
 * open it, move its status, edit or delete it — is decided per task in the
 * service (modules/work/workAccess.ts).
 */
const TASK_ACCESS = [PERMISSIONS.TASKS_VIEW, PERMISSIONS.TASKS_MANAGE];

const statusEnum = z.enum(TASK_STATUS_ORDER as [string, ...string[]]);

const checklistItem = z.object({
  _id: objectIdSchema.optional(),
  text: z.string().trim().min(1).max(500),
  done: z.boolean().optional(),
});

const taskLabel = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(20),
});

const createTaskBody = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  description: z.string().trim().max(5000).optional(),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  status: statusEnum.optional(),
  assignedTo: z.array(objectIdSchema).max(50).optional(),
  checklist: z.array(checklistItem).max(100).optional(),
  labels: z.array(taskLabel).max(20).optional(),
  images: z.array(z.string()).max(20).optional(),
  leadId: objectIdSchema.optional(),
  /** Written on the create form before the task existed; authored by the caller. */
  comments: z
    .array(z.object({ text: z.string().trim().min(1).max(5000) }))
    .max(50)
    .optional(),
});

const updateTaskBody = createTaskBody
  .omit({ comments: true, leadId: true })
  .partial()
  // null unlinks the lead.
  .extend({ leadId: objectIdSchema.nullable().optional() });

const taskFilters = {
  leadId: objectIdSchema.optional(),
  assignedTo: objectIdSchema.optional(),
  bucket: z.enum(['mine', 'assigned']).optional(),
  overdue: booleanQuery.optional(),
  scope: z.enum(['today', 'tomorrow']).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  label: z.string().trim().max(40).optional(),
};

const listTasksQuery = paginationQuery.extend({ status: statusEnum.optional(), ...taskFilters });
const statusCountsQuery = z.object(taskFilters);

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.addHook('preHandler', app.authenticateTenant);

  r.route({
    method: 'GET',
    url: '/stats/status-counts',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Task counts per status, for the filter tabs',
      description: 'Takes the list’s filters, so the counts match the rows it shows.',
      security,
      querystring: statusCountsQuery,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(await taskService.statusCounts(viewerOf(request), request.query)),
  });

  r.route({
    method: 'GET',
    url: '/labels',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Labels in use on the tasks you can see, for the filter',
      security,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await taskService.labels(viewerOf(request))),
  });

  r.route({
    method: 'GET',
    url: '/',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'List tasks',
      description:
        'Organizers see every task; everyone else what is assigned to or raised by ' +
        'them. With `leadId`, every task on that lead, for anyone who can see the lead.',
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
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Create a task',
      description:
        'Assignees must be active members; a linked lead must be one the caller ' +
        'can see; the end date cannot precede the start.',
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
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Get one task (participants, organizers, and the owner of its lead)',
      security,
      params: idParam,
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) => ok(await taskService.getById(request.params.id, viewerOf(request))),
  });

  r.route({
    method: 'PUT',
    url: '/:id',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Edit a task (its creator or an organizer)',
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
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Move a task to another status',
      security,
      params: idParam,
      body: z.object({ status: statusEnum }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await taskService.setStatus(
          request.params.id,
          request.body.status as TaskStatus,
          viewerOf(request)
        )
      ),
  });

  r.route({
    method: 'POST',
    url: '/:id/comments',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
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
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Toggle a checklist item',
      security,
      params: z.object({ id: objectIdSchema, itemId: objectIdSchema }),
      response: { 200: okEnvelope, ...commonErrors },
    },
    handler: async (request) =>
      ok(
        await taskService.toggleChecklistItem(
          request.params.id,
          request.params.itemId,
          viewerOf(request)
        )
      ),
  });

  r.route({
    method: 'DELETE',
    url: '/:id',
    preHandler: [app.requirePermission(...TASK_ACCESS)],
    schema: {
      tags: ['tasks'],
      summary: 'Soft-delete a task (its creator or an organizer)',
      security,
      params: idParam,
      response: { 200: messageEnvelope, ...commonErrors },
    },
    handler: async (request) => {
      await taskService.remove(request.params.id, viewerOf(request));
      return message('Task deleted');
    },
  });
}
