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
		created_at TEXT NOT NULL
	);
`);

ensureColumn('metadata_tables', 'user_friendly_name', 'user_friendly_name TEXT');
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

export const db = drizzle(client, { schema });
