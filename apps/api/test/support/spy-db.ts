import type { D1DatabaseLike, D1StatementLike, D1Value } from '@bluelytics/db';

/** A D1 wrapper that records every executed query and can be switched to fail. */
export interface SpyDb extends D1DatabaseLike {
  /** `sql` + bound values of each executed statement, in order. */
  readonly queries: { sql: string; values: D1Value[] }[];
  failing: boolean;
}

export function spyDb(inner: D1DatabaseLike): SpyDb {
  const queries: SpyDb['queries'] = [];
  const spy: SpyDb = {
    queries,
    failing: false,
    prepare(sql) {
      return wrap(inner.prepare(sql), sql, []);
    },
    batch(statements) {
      if (spy.failing) return Promise.reject(new Error('D1 is down (test)'));
      return inner.batch(statements);
    },
  };

  function wrap(statement: D1StatementLike, sql: string, values: D1Value[]): D1StatementLike {
    const run = <T>(execute: () => Promise<T>): Promise<T> => {
      if (spy.failing) return Promise.reject(new Error('D1 is down (test)'));
      queries.push({ sql, values });
      return execute();
    };
    return {
      bind: (...bound) => wrap(statement.bind(...bound), sql, bound),
      first: () => run(() => statement.first()),
      all: () => run(() => statement.all()),
      run: () => run(() => statement.run()),
    } as D1StatementLike;
  }

  return spy;
}
