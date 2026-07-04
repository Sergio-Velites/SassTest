import { sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (citext extension) for emails and slugs. */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/** Standard columns every table carries (DATA_MODEL.md conventions). */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
