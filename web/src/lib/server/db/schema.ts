import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const databaseConnections = sqliteTable('database_connections', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().default('Primary database'),
	type: text('type').notNull().default('sqlite'),
	connectionString: text('connection_string').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const metadataTables = sqliteTable('metadata_tables', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	userFriendlyName: text('user_friendly_name'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const tableFiles = sqliteTable('table_files', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tableId: integer('table_id')
		.notNull()
		.references(() => metadataTables.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	content: text('content').notNull(),
	mimeType: text('mime_type').notNull().default('text/plain'),
	createdAt: text('created_at').notNull()
});

export const tableMetadata = sqliteTable('table_metadata', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	tableId: integer('table_id')
		.notNull()
		.unique()
		.references(() => metadataTables.id, { onDelete: 'cascade' }),
	fileName: text('file_name').notNull(),
	json: text('json').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const appUsers = sqliteTable('app_users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userKey: text('user_key').notNull().unique(),
	allowedTableIdsJson: text('allowed_table_ids_json').notNull().default('[]'),
	tableRestrictionsJson: text('table_restrictions_json').notNull().default('{}'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const askChats = sqliteTable('ask_chats', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userKey: text('user_key').notNull().default(''),
	title: text('title').notNull(),
	selectedTableIdsJson: text('selected_table_ids_json').notNull().default('[]'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const askMessages = sqliteTable('ask_messages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	chatId: integer('chat_id')
		.notNull()
		.references(() => askChats.id, { onDelete: 'cascade' }),
	role: text('role').notNull(),
	content: text('content').notNull(),
	sql: text('sql'),
	rowsJson: text('rows_json'),
	createdAt: text('created_at').notNull()
});
