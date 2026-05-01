import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);

client.pragma('foreign_keys = ON');

function ensureColumn(table: string, column: string, definition: string) {
	const columns = client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (!columns.some((currentColumn) => currentColumn.name === column)) {
		client.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	}
}

client.exec(`
	CREATE TABLE IF NOT EXISTS database_connections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL DEFAULT 'Primary database',
		type TEXT NOT NULL DEFAULT 'sqlite',
		connection_string TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS metadata_tables (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		user_friendly_name TEXT,
		filter_test_row_count INTEGER,
		filter_test_limit INTEGER,
		filter_test_has_less_than_limit INTEGER NOT NULL DEFAULT 0,
		filter_test_checked_at TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS table_files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		table_id INTEGER NOT NULL REFERENCES metadata_tables(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		content TEXT NOT NULL,
		mime_type TEXT NOT NULL DEFAULT 'text/plain',
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS table_metadata (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		table_id INTEGER NOT NULL UNIQUE REFERENCES metadata_tables(id) ON DELETE CASCADE,
		file_name TEXT NOT NULL,
		json TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS app_users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_key TEXT NOT NULL UNIQUE,
		allowed_table_ids_json TEXT NOT NULL DEFAULT '[]',
		table_restrictions_json TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ask_chats (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_key TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL,
		selected_table_ids_json TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ask_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id INTEGER NOT NULL REFERENCES ask_chats(id) ON DELETE CASCADE,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		sql TEXT,
		rows_json TEXT,
		answer_page_json TEXT,
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ai_tasks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_key TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		interval_minutes INTEGER NOT NULL,
		sql TEXT NOT NULL DEFAULT '',
		routine_code TEXT NOT NULL DEFAULT '',
		visual_prompt TEXT NOT NULL,
		selected_table_ids_json TEXT NOT NULL DEFAULT '[]',
		is_active INTEGER NOT NULL DEFAULT 1,
		last_run_at TEXT,
		next_run_at TEXT NOT NULL,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ai_task_runs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		task_id INTEGER NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
		status TEXT NOT NULL,
		sql TEXT NOT NULL DEFAULT '',
		executed_sql_json TEXT,
		rows_json TEXT,
		page_spec_json TEXT,
		report_title TEXT,
		report_summary TEXT,
		report_html TEXT,
		error TEXT,
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_key TEXT NOT NULL DEFAULT '',
		task_id INTEGER REFERENCES ai_tasks(id) ON DELETE CASCADE,
		run_id INTEGER REFERENCES ai_task_runs(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		message TEXT NOT NULL,
		read_at TEXT,
		created_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ai_pages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_key TEXT NOT NULL DEFAULT '',
		title TEXT NOT NULL,
		description TEXT NOT NULL,
		page_code TEXT NOT NULL,
		visual_prompt TEXT NOT NULL,
		selected_table_ids_json TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
`);

ensureColumn('metadata_tables', 'user_friendly_name', 'user_friendly_name TEXT');
ensureColumn('metadata_tables', 'filter_test_row_count', 'filter_test_row_count INTEGER');
ensureColumn('metadata_tables', 'filter_test_limit', 'filter_test_limit INTEGER');
ensureColumn(
	'metadata_tables',
	'filter_test_has_less_than_limit',
	'filter_test_has_less_than_limit INTEGER NOT NULL DEFAULT 0'
);
ensureColumn('metadata_tables', 'filter_test_checked_at', 'filter_test_checked_at TEXT');
ensureColumn(
	'ask_chats',
	'selected_table_ids_json',
	"selected_table_ids_json TEXT NOT NULL DEFAULT '[]'"
);
ensureColumn('ask_chats', 'user_key', "user_key TEXT NOT NULL DEFAULT ''");
ensureColumn(
	'app_users',
	'allowed_table_ids_json',
	"allowed_table_ids_json TEXT NOT NULL DEFAULT '[]'"
);
ensureColumn(
	'app_users',
	'table_restrictions_json',
	"table_restrictions_json TEXT NOT NULL DEFAULT '{}'"
);
ensureColumn('ask_messages', 'answer_page_json', 'answer_page_json TEXT');
ensureColumn(
	'ai_tasks',
	'selected_table_ids_json',
	"selected_table_ids_json TEXT NOT NULL DEFAULT '[]'"
);
ensureColumn('ai_tasks', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
ensureColumn('ai_tasks', 'routine_code', "routine_code TEXT NOT NULL DEFAULT ''");
ensureColumn('ai_task_runs', 'executed_sql_json', 'executed_sql_json TEXT');
ensureColumn('ai_task_runs', 'report_title', 'report_title TEXT');
ensureColumn('ai_task_runs', 'report_summary', 'report_summary TEXT');
ensureColumn('ai_task_runs', 'report_html', 'report_html TEXT');
ensureColumn(
	'ai_pages',
	'selected_table_ids_json',
	"selected_table_ids_json TEXT NOT NULL DEFAULT '[]'"
);

export const db = drizzle(client, { schema });
