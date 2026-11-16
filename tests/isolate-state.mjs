// Never read or replace the caller's session while running offline tests.
// Test files run in separate Node processes; path-override tests set their own value.
delete process.env.AVITO_SESSION_FILE;
