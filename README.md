# ecsql-ls

A language server and vscode extension for [ECSQL](https://www.itwinjs.org/learning/ecsql/).

Currently as a minimum viable implementation it uses a configured regex to search for calls on objects to
`query` or `withPreparedStatement` and then tries to the parse the following string literal as a SQL query.
It will then provide some auto-completion depending on where your cursor is in the query.


## USAGE REQUIREMENT

At the moment, you can only get auto complete in your ECSQL in vscode by setting the following vscode setting.

```json
{
  "editor.quickSuggestions": {
    "strings": true
  }
}
```

In the future this should not be necessary to set yourself.

## Features

- auto-complete new columns in `SELECT` statements based on which tables you are querying
- auto-complete new tables in `FROM` clauses based on which columns you are selecting
- auto-complete columns in `ON` and `WHERE` conditions, including aliases, `SELECT`ed and non-`SELECT`-ed columns

## TODO

- on-hover determine from which table a column must be from and provide the documentation of the most-derived class,
  currently just finds the first matching property
- don't limit `FROM` auto-complete to tables that contain the `SELECT`ed attributes, instead prioritize those and the list the rest.
- process more than just the BisCore schema

## Building

```sh
pnpm -r run prebuild
pnpm run bundle
pnpm run package
```
