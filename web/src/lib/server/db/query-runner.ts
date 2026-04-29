import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import pg from 'pg';

export type DatabaseType = 'postgres' | 'mysql' | 'sqlite';

export function isDatabaseType(value: string): value is DatabaseType {
	return value === 'postgres' || value === 'mysql' || value === 'sqlite';
}

export function getDialectName(type: string) {
	if (type === 'postgres') return 'PostgreSQL';
	if (type === 'mysql') return 'MySQL';
	return 'SQLite';
}

export async function runReadOnlyQuery(
	type: DatabaseType,
	connectionString: string,
	sql: string
): Promise<Array<Record<string, unknown>>> {
	if (type === 'postgres') return runPostgresQuery(connectionString, sql);
	if (type === 'mysql') return runMysqlQuery(connectionString, sql);
	return runSqliteQuery(connectionString, sql);
}

export async function testDatabaseConnection(type: DatabaseType, connectionString: string) {
	await runReadOnlyQuery(type, connectionString, 'SELECT 1 AS connection_test');
}

async function runPostgresQuery(connectionString: string, sql: string) {
	const client = new pg.Client({ connectionString });
	await client.connect();

	try {
		await client.query('BEGIN READ ONLY');
		const result = await client.query(sql);
		await client.query('ROLLBACK');
		return result.rows as Array<Record<string, unknown>>;
	} catch (error) {
		await client.query('ROLLBACK').catch(() => undefined);
		throw error;
	} finally {
		await client.end();
	}
}

async function runMysqlQuery(connectionString: string, sql: string) {
	const connection = await mysql.createConnection(connectionString);

	try {
		await connection.query('START TRANSACTION READ ONLY');
		const [rows] = await connection.query(sql);
		await connection.query('ROLLBACK');
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	} catch (error) {
		await connection.query('ROLLBACK').catch(() => undefined);
		throw error;
	} finally {
		await connection.end();
	}
}

function runSqliteQuery(connectionString: string, sql: string) {
	const database = new Database(connectionString, {
		readonly: true,
		fileMustExist: true
	});

	try {
		return database.prepare(sql).all() as Array<Record<string, unknown>>;
	} finally {
		database.close();
	}
}
