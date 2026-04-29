import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const client = new Database(env.DATABASE_URL);

client.pragma('foreign_keys = ON');
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

	CREATE TABLE IF NOT EXISTS compiled_metadata (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_name TEXT NOT NULL,
		json TEXT NOT NULL,
		created_at TEXT NOT NULL
	);
`);

export const db = drizzle(client, { schema });
