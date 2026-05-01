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
	filterTestRowCount: integer('filter_test_row_count'),
	filterTestLimit: integer('filter_test_limit'),
	filterTestHasLessThanLimit: integer('filter_test_has_less_than_limit').notNull().default(0),
	filterTestCheckedAt: text('filter_test_checked_at'),
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
	answerPageJson: text('answer_page_json'),
	createdAt: text('created_at').notNull()
});

export const aiTasks = sqliteTable('ai_tasks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userKey: text('user_key').notNull().default(''),
	title: text('title').notNull(),
	description: text('description').notNull(),
	intervalMinutes: integer('interval_minutes').notNull(),
	sql: text('sql').notNull().default(''),
	routineCode: text('routine_code').notNull().default(''),
	visualPrompt: text('visual_prompt').notNull(),
	selectedTableIdsJson: text('selected_table_ids_json').notNull().default('[]'),
	isActive: integer('is_active').notNull().default(1),
	lastRunAt: text('last_run_at'),
	nextRunAt: text('next_run_at').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const aiTaskRuns = sqliteTable('ai_task_runs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => aiTasks.id, { onDelete: 'cascade' }),
	status: text('status').notNull(),
	sql: text('sql').notNull().default(''),
	executedSqlJson: text('executed_sql_json'),
	rowsJson: text('rows_json'),
	pageSpecJson: text('page_spec_json'),
	reportTitle: text('report_title'),
	reportSummary: text('report_summary'),
	reportHtml: text('report_html'),
	error: text('error'),
	createdAt: text('created_at').notNull()
});

export const notifications = sqliteTable('notifications', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userKey: text('user_key').notNull().default(''),
	taskId: integer('task_id').references(() => aiTasks.id, { onDelete: 'cascade' }),
	runId: integer('run_id').references(() => aiTaskRuns.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	message: text('message').notNull(),
	readAt: text('read_at'),
	createdAt: text('created_at').notNull()
});

export const aiPages = sqliteTable('ai_pages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userKey: text('user_key').notNull().default(''),
	title: text('title').notNull(),
	description: text('description').notNull(),
	pageCode: text('page_code').notNull(),
	visualPrompt: text('visual_prompt').notNull(),
	selectedTableIdsJson: text('selected_table_ids_json').notNull().default('[]'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});
