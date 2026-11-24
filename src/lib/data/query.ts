/**
 * Small helpers for loaders that start their queries in parallel.
 *
 * A Supabase query builder is a lazy "thenable": every `.then()` sends the request again.
 * `once()` turns it into a real promise (sent once) that several chained queries can share;
 * `rows()` sends one and returns its rows ([] when the database returned none or refused).
 */
export function once<T>(query: PromiseLike<T>): Promise<T> {
  return Promise.resolve(query);
}

export async function rows<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  return (await query).data ?? [];
}
