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

export function extractReadOnlySql(value: string) {
	const fenced = value.match(/```(?:sql)?\s*([\s\S]*?)```/i)?.[1] ?? value;
	const sql = fenced.trim().replace(/;+\s*$/, '');
	if (!/^(select|with)\b/i.test(sql)) {
		throw new Error('The AI did not provide a read-only SELECT query.');
	}
	if (sql.includes(';')) {
		throw new Error('Only one SQL statement can be executed.');
	}
	return sql;
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

export async function listDatabaseTableNames(type: DatabaseType, connectionString: string) {
	const rows = await runReadOnlyQuery(type, connectionString, getTableNamesSql(type));
	const names = rows
		.map((row) => row.name)
		.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
		.map((name) => name.trim());

	return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

export async function listDatabaseTableFields(
	type: DatabaseType,
	connectionString: string,
	tableName: string
) {
	const rows = await runReadOnlyQuery(type, connectionString, getTableFieldsSql(type, tableName));
	const fields = rows
		.map((row) => row.name)
		.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
		.map((name) => name.trim());

	return [...new Set(fields)];
}

function getTableNamesSql(type: DatabaseType) {
	if (type === 'postgres') {
		return `
			SELECT table_name AS name
			FROM information_schema.tables
			WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
				AND table_type = 'BASE TABLE'
			ORDER BY table_name
		`;
	}

	if (type === 'mysql') {
		return `
			SELECT table_name AS name
			FROM information_schema.tables
			WHERE table_schema = DATABASE()
				AND table_type = 'BASE TABLE'
			ORDER BY table_name
		`;
	}

	return `
		SELECT name
		FROM sqlite_schema
		WHERE type = 'table'
			AND name NOT LIKE 'sqlite_%'
		ORDER BY name
	`;
}

function getTableFieldsSql(type: DatabaseType, tableName: string) {
	if (type === 'postgres') {
		return `
			SELECT column_name AS name
			FROM information_schema.columns
			WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
				AND table_name = ${sqlString(tableName)}
			ORDER BY ordinal_position
		`;
	}

	if (type === 'mysql') {
		return `
			SELECT column_name AS name
			FROM information_schema.columns
			WHERE table_schema = DATABASE()
				AND table_name = ${sqlString(tableName)}
			ORDER BY ordinal_position
		`;
	}

	return `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`;
}

function sqlString(value: string) {
	return `'${value.replace(/'/g, "''")}'`;
}

function quoteSqliteIdentifier(value: string) {
	return `"${value.replace(/"/g, '""')}"`;
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
