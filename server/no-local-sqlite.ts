// Worker builds never open a local SQLite file.
export class DatabaseSync { constructor(..._args: any[]) { throw new Error('Use Cloudflare D1 binding DB'); } }
