import { booleanQuery, paginationQuery } from '../../lib/schemas.js';

export const listNotificationsQuery = paginationQuery.extend({
  unreadOnly: booleanQuery.optional(),
});
