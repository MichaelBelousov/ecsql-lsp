/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fse from "fs-extra";
import * as path from "path";
import * as xml2js from "xml2js";

import * as TreeSitter from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";

// in the future read all unversioned .ecschema.xml files in the repo
import bisCoreSchemaText from "./assets/BisCore.ecschema.xml";

const parser = new TreeSitter();
parser.setLanguage(TreeSitterSql);

export interface SelectStatementMatch {
	select: TreeSitter.SyntaxNode;
	from: TreeSitter.SyntaxNode;
	joins: TreeSitter.SyntaxNode[];
	tables: ECClass[];
}

// The example settings
interface ExtensionSettings {
	fallbackIModelUrl: string;
	queryCallRegex: string;
}


const extensionPackageJson = fse.readJsonSync(path.join(__dirname, "../package.json"));


// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: ExtensionSettings = {
	queryCallRegex: extensionPackageJson.contributes.configuration.properties["ecsql-lsp.queryCallRegex"],
	fallbackIModelUrl: extensionPackageJson.contributes.configuration.properties["ecsql-lsp.fallbackIModelUrl"],
};
let globalSettings: ExtensionSettings = defaultSettings;


// TODO: may want to suggest tables when there is an error after a FROM
export const selectStatementsQuery = new TreeSitter.Query(
	TreeSitterSql,
	"(select_statement (from_clause (identifier) @from-name)? @from (join_clause . (identifier) @join-name)* @joins) @select"
);

export function getCurrentSelectStatement(
  suggestions: SuggestionsCache,
  cursorOffsetInSql: number,
  queryAst: TreeSitter.Tree
): SelectStatementMatch | undefined {
  const matches = selectStatementsQuery.matches(queryAst.rootNode);
  const current = matches.reduce(
    (prev, match) =>
      match.captures[0 /*select*/].node.startIndex <= cursorOffsetInSql &&
      match.captures[0 /*select*/].node.endIndex >= cursorOffsetInSql
        ? !prev ||
          (match.captures[0 /*select*/].node.startIndex >=
            prev.captures[0 /*select*/].node.startIndex &&
            match.captures[0 /*select*/].node.endIndex <=
              prev.captures[0 /*select*/].node.endIndex)
          ? match
          : prev
        : undefined,
    undefined as TreeSitter.QueryMatch | undefined
  );
  return (
    current && {
      select: current.captures[0 /*select*/].node,
      from: current.captures[1 /*from*/].node,
      joins: current.captures
        .filter((c) => c.name === "joins")
        .map((c) => c.node),
      tables: [
        current.captures[2 /*from-name*/].node.text!,
        ...current.captures
          .filter((c) => c.name === "join-name")
          .map((c) => c.node.text!),
      ]
			.map(fullName => {
				const [schema, name] = fullName.split(".");
				return { schema, name };
			})
			.filter(({schema, name}) => name !== undefined && schema in suggestions.schemas && name in suggestions.schemas[schema])
			.map(({schema, name}) => new ECClass({
				schema,
				name,
				data: suggestions.schemas[schema][name],
			})),
    }
  );
}

export const queriedPropsQuery = new TreeSitter.Query(
	TreeSitterSql,
	'(select_clause_body [(identifier) (alias (identifier) . "AS" . (identifier))] @col)'
);

/** get the names of properties queried for */
export function getQueriedProperties(query: SourceQuery): string[] {
	const matches = queriedPropsQuery.matches(query.ast.rootNode);
	return matches.map((match) =>
    match.captures[0].node.type === "alias"
      ? match.captures[0].node.namedChild(0)!.text!
      : match.captures[0].node.text!
  );
}

export const queriedNamesQuery = new TreeSitter.Query(
	TreeSitterSql,
	'(select_clause_body [(identifier) (alias (identifier) .)] @col)'
);

/**
 * get the alias names in a query
 * @note this currently gets all names, not just those of aliases! It is a misnomer and I should rename it
 */
export function getAliasNames(query: SourceQuery): string[] {
	const matches = queriedNamesQuery.matches(query.ast.rootNode);
	return matches.map((match) =>
    match.captures[0].node.type === "alias"
      ? match.captures[0].node.namedChild(0)!.text!
      : match.captures[0].node.text!
  );
}

/** given a (partial) query, guess the classes it wants to query */
export function guessClasses(suggestions: SuggestionsCache, query: SourceQuery, prefix?: string): ECClass[] {
	const queriedProps = getQueriedProperties(query);
	const classes = new Set<ECClass>();
	for (const queriedProp of queriedProps) {
		for (const ecclass of suggestions.propertyToContainingClasses.get(queriedProp.toLowerCase()) ?? []) {
			if (prefix &&
				!( `${ecclass.schema}.${ecclass.name}`.startsWith(prefix)
				|| `${ecclass.alias(suggestions)}.${ecclass.name}`.startsWith(prefix)))
				continue;
			classes.add(ecclass);
		}
	}
	return [...classes];
}

type SqlKeywordString = "FROM" | "JOIN" | "SELECT" | "ON" | "WHERE" | "GROUP BY";

export function getQueryEditClauseType(query: SourceQuery, cursor: number): SqlKeywordString | undefined {
	// TODO: use lazy-from's .last here
	const prevKeyword = [...query.src.slice(0, cursor).matchAll(/FROM|JOIN|SELECT|ON|WHERE|GROUP BY|;|\)/g)].pop();
	return prevKeyword?.[0] as undefined | SqlKeywordString;
}

export function suggestForQueryEdit(suggestions: SuggestionsCache, query: SourceQuery, cursor: number, prefix?: string): CompletionItem[] | undefined {
	const editingClauseType = getQueryEditClauseType(query, cursor);
	const isEditingSelectClause = editingClauseType === "SELECT";
	const isEditingConditionClause = editingClauseType === "WHERE" || editingClauseType === "ON";
	if (editingClauseType === undefined)
		return undefined;
	if (editingClauseType === "FROM" || editingClauseType === "JOIN") {
		const tables = query.selectData(suggestions)?.tables;
		return guessClasses(suggestions, query, prefix)
		.filter((cls) => !tables || !tables.some(t => t.name === cls.name && t.schema === cls.schema))
		.map((ecclass) => {
			const usingAlias = !prefix?.startsWith(ecclass.schema);
			const schemaIdent = usingAlias ? ecclass.alias(suggestions) : ecclass.schema;
			const fullClassRef = `${schemaIdent}.${ecclass.name}`;
			return {
				label: fullClassRef,
				insertText: fullClassRef,
				kind: CompletionItemKind.Class,
				//data: `${schemaName}.${className}.${propertyName}`, // use lodash.get if doing this?
				detail: ecclass.data.$.displayLabel,
				documentation: ecclass.data.$.description,
			};
		});
	} else if (isEditingSelectClause || isEditingConditionClause) {
		// TODO: do not suggest properties that they already have listed
		// TODO: suggest '*'
		const guessedClasses: ECClass[] = query.selectData(suggestions)?.tables ?? guessClasses(suggestions, query);
		const includeClass = (className: string) => guessedClasses.length === 0 ? true : guessedClasses.some(c => c.name.toLowerCase() === className);
		// TODO: need to add implicit ECInstanceId
		const guessedProperties = new Map<string, {propertyName: string; data: any}>();
		for (const schemaName in suggestions.schemas) {
			for (const className in suggestions.schemas[schemaName]) {
				if (!includeClass(className)) continue;
				const classSuggestions = suggestions.schemas[schemaName][className];
				for (const propertyName in classSuggestions) {
					const property = classSuggestions[propertyName];
					const propertyKey = propertyName.toLowerCase();
					if (prefix && !propertyKey.startsWith(prefix.toLowerCase())) continue;
					// TODO: need to provide priority to collisions (e.g. least derived class)
					guessedProperties.set(propertyKey, {
						propertyName: property.$.propertyName, // HACK: need a better way to get the correctly capitalized name
						data: property,
					});
				}
			}
		}
		if (isEditingSelectClause) {
			// TODO: use lazy-from
			// FIXME: this will match classes that have the same name across schemas
			return [...guessedProperties.values()].map(({propertyName, data}) => ({
				label: propertyName,
				insertText: propertyName,
				kind: CompletionItemKind.Field,
				//data: `${schemaName}.${className}.${propertyName}`,
				detail: data.$.displayLabel,
				documentation: data.$.description,
			}));
		} else if (isEditingConditionClause) {
			const aliases = getAliasNames(query);
			return [
				...[...guessedProperties.values()].map(({propertyName, data}) => ({
						label: propertyName,
						insertText: propertyName,
						kind: CompletionItemKind.Field,
						//data: `${schemaName}.${className}.${propertyName}`,
						detail: data.$.displayLabel,
						documentation: data.$.description,
				})),
				...aliases.map((alias) => ({
						label: alias,
						insertText: alias,
						kind: CompletionItemKind.Field,
						// TODO: generate alias data from mapping
						//detail: data.$.extendedTypeName ?? "no extended type",
						//documentation: data.$.description,
				})),
			].filter(completion => !prefix || completion.insertText.startsWith(prefix));
		}
	}
}

export interface SourceQuery {
	start: number;
	end: number;
	ast: TreeSitter.Tree;
	src: string;
	selectData(s: SuggestionsCache): SelectStatementMatch | undefined;
}

export function findAllQueries(text: string): SourceQuery[] {
	const results: SourceQuery[] = [];
	for (const match of text.matchAll(/(i[mM]odel|[dD]b)\.(query|withPreparedStatment)\(/g)) {
		const matchStart = match.index!;
		const matchEnd = match.index! + match[0].length;
		const literal = getNextStringLiteral(text, matchEnd);
		if (literal) {
			let ast: TreeSitter.Tree;
			const source = literal.slice(1, -1);
			try {
				// TODO: provide the old tree and separate by `;` to do more performant re-parses
				ast = parser.parse(source);
			} catch {
				continue;
			}
			results.push({
				// FIXME: get actual location in literal finding
				start: matchEnd,
				end: matchEnd + literal.length,
				src: source,
				ast,
				selectData(suggestions: SuggestionsCache) {
					return getCurrentSelectStatement(suggestions, matchStart, ast);
				},
			});
		}
	}
	return results;
}

// start only supporting double quotes, need to support single and backtick with nesting
function getNextStringLiteral(text: string, offset: number): string | undefined {
	//const stack = [];
	//let state = '/'
	//let last = undefined;
	//for (const chr of text) {
		//if ()
		//last = chr;
	//}
	return /".*?(?<!\\)"/s.exec(text.slice(offset))?.[0] ?? undefined;
}

import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

//const cachedBisSchemaRepoPath = path.join(__dirname, ".bis-schemas-cache");


interface ECClassProps {
	schema: string;
	name: string;
	/** raw xml data */
	data: any;
}

class ECClass implements ECClassProps {
	schema!: string;
	name!: string;
	data!: any;
	public constructor(props: ECClassProps) {
		Object.assign(this, props);
	}
	alias(s: SuggestionsCache): string { return s.schemaAliases.get(this.schema)!; }
}

export interface SuggestionsCache {
	propertyToContainingClasses: Map<string, Set<ECClass>>,
	schemaAliases: Map<string, string>;

	schemas: {
		[schemaName: string]: {
			[className: string]: {
				[propertyName: string]: any;
			}
		}
	}
}

export async function processSchemaForSuggestions(schemaText: string, suggestions: SuggestionsCache): Promise<void> {
	const xmlParser = new xml2js.Parser();
	const schemaXml = await xmlParser.parseStringPromise(schemaText);
	const schemaName: string = schemaXml.ECSchema.$.schemaName;
	const schemaAlias: string = schemaXml.ECSchema.$.alias;
	suggestions.schemaAliases.set(schemaName, schemaAlias);
	const schemaSuggestions: SuggestionsCache["schemas"][string] = {};
	suggestions.schemas[schemaName.toLowerCase()] = schemaSuggestions;
	suggestions.schemas[schemaAlias.toLowerCase()] = schemaSuggestions;

	const unresolvedClasses = new Map<string, any>(schemaXml.ECSchema.ECEntityClass.map((xml: any) => [xml.$.typeName, xml]));
	const resolvedClasses = new Map<string, any>();

	function resolveClass(className: string) {
		if (resolvedClasses.has(className)) return;
		const classXml = unresolvedClasses.get(className);
		const classSuggestions: SuggestionsCache["schemas"][string][string] = {};
		for (const xmlPropType of ["ECProperty", "ECStructProperty", "ECNavigationProperty", "ECArrayProperty"]) {
			for (const prop of classXml?.[xmlPropType] ?? []) {
				const propName: string = prop.$.propertyName;
				classSuggestions[propName.toLowerCase()] = prop;
				let thisPropNameContainingClasses = suggestions.propertyToContainingClasses.get(propName.toLowerCase());
				if (thisPropNameContainingClasses === undefined) {
					thisPropNameContainingClasses = new Set();
					suggestions.propertyToContainingClasses.set(propName.toLowerCase(), thisPropNameContainingClasses);
				}
				thisPropNameContainingClasses.add(new ECClass({ schema: schemaName, name: className, data: classXml }));
			}
		}
		for (const baseClassName of classXml?.BaseClass ?? []) {
			if (!resolvedClasses.has(baseClassName.toLowerCase())) resolveClass(baseClassName);
			for (const baseClassPropName in suggestions.schemas[schemaName.toLowerCase()][baseClassName.toLowerCase()]) {
				const baseClassProp = suggestions.schemas[schemaName.toLowerCase()][baseClassName.toLowerCase()][baseClassPropName.toLowerCase()];
				classSuggestions[baseClassPropName.toLowerCase()] = baseClassProp;
			}
		}
		suggestions.schemas[schemaName.toLowerCase()][className.toLowerCase()] = classSuggestions;
		resolvedClasses.set(className, classSuggestions);
		unresolvedClasses.delete(className);
		return classXml;
	}

	for (const className of unresolvedClasses.keys()) {
		resolveClass(className)
	}
}

export async function buildSuggestions() {
	const suggestions: SuggestionsCache = {
		schemas: {},
		propertyToContainingClasses: new Map(),
		schemaAliases: new Map(),
	};
	await processSchemaForSuggestions(bisCoreSchemaText, suggestions);
	return suggestions;
}

export function suggestQueryEditInDocument(suggestions: SuggestionsCache, text: string, offset: number) {
	const queries = findAllQueries(text);
	if (queries.length === 0) return [];

	const queryWeAreIn = queries.find(q => q.start <= offset && q.end >= offset);
	if (queryWeAreIn === undefined) return [];

	const offsetInQuery = offset - queryWeAreIn.start - 1; // TODO: double check this...

	const textBehindPos = text.slice(0, offset);
	const currentWordMatch = /[\w.]+$/.exec(textBehindPos);
	const currentWord = currentWordMatch?.[0] ?? "";

	return suggestForQueryEdit(suggestions, queryWeAreIn, offsetInQuery, currentWord) ?? [];
}

function main() {
	/*
	// TODO: manage BisSchemas updates
	if (!fse.existsSync(cachedBisSchemaRepoPath)) {
		// TODO: use vscode configured git path
		console.log("caching Bis-Schemas repo");
		// Is it possible to sparse-checkout and avoid the cost of checking out the cmap stuff too?
		// Maybe it's just better to use github's API to pull the necessary files and cache a revision number
		child_process.execFileSync("git", ["clone", "https://github.com/iTwin/bis-schemas", cachedBisSchemaRepoPath]);
		console.log("done caching Bis-Schemas repo");
	} else {
		console.log(`found existing cached Bis-Schemas repo at: ${cachedBisSchemaRepoPath}`);
	}
	*/

	const suggestionsPromise = buildSuggestions();

	// Create a connection for the server, using Node's IPC as a transport.
	// Also include all preview / proposed LSP features.
	const connection = createConnection(ProposedFeatures.all);

	// Create a simple text document manager.
	const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

	let hasConfigurationCapability = false;
	let hasWorkspaceFolderCapability = false;
	let hasDiagnosticRelatedInformationCapability = false;

	connection.onInitialize((params: InitializeParams) => {
		const capabilities = params.capabilities;

		// Does the client support the `workspace/configuration` request?
		// If not, we fall back using global settings.
		hasConfigurationCapability = !!(
			capabilities.workspace && !!capabilities.workspace.configuration
		);
		hasWorkspaceFolderCapability = !!(
			capabilities.workspace && !!capabilities.workspace.workspaceFolders
		);
		hasDiagnosticRelatedInformationCapability = !!(
			capabilities.textDocument &&
			capabilities.textDocument.publishDiagnostics &&
			capabilities.textDocument.publishDiagnostics.relatedInformation
		);

		const result: InitializeResult = {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				// Tell the client that this server supports code completion.
				completionProvider: {
					resolveProvider: true,
				}
			}
		};
		if (hasWorkspaceFolderCapability) {
			result.capabilities.workspace = {
				workspaceFolders: {
					supported: true
				}
			};
		}
		return result;
	});

	connection.onInitialized(() => {
		if (hasConfigurationCapability) {
			// Register for all configuration changes.
			connection.client.register(DidChangeConfigurationNotification.type, undefined);
		}
		if (hasWorkspaceFolderCapability) {
			connection.workspace.onDidChangeWorkspaceFolders(_event => {
				connection.console.log('Workspace folder change event received.');
			});
		}
	});

	// Cache the settings of all open documents
	const documentSettings: Map<string, Thenable<ExtensionSettings>> = new Map();

	connection.onDidChangeConfiguration(change => {
		if (hasConfigurationCapability) {
			// Reset all cached document settings
			documentSettings.clear();
		} else {
			globalSettings = (
				(change.settings.ecsqlLanguageServer || defaultSettings) as ExtensionSettings
			);
		}

		// Revalidate all open text documents
		//documents.all().forEach(validateTextDocument);
	});

	function getDocumentSettings(resource: string): Thenable<ExtensionSettings> {
		if (!hasConfigurationCapability) {
			return Promise.resolve(globalSettings);
		}
		let result = documentSettings.get(resource);
		if (!result) {
			result = connection.workspace.getConfiguration({
				scopeUri: resource,
				section: 'ecsqlLanguageServer '
			});
			documentSettings.set(resource, result);
		}
		return result;
	}

	// Only keep settings for open documents
	documents.onDidClose(e => {
		documentSettings.delete(e.document.uri);
	});

	// The content of a text document has changed. This event is emitted
	// when the text document first opened or when its content has changed.
	/*documents.onDidChangeContent(change => {
		validateTextDocument(change.document);
	});*/

	async function validateTextDocument(textDocument: TextDocument): Promise<void> {
		// In this simple example we get the settings for every validate run.
		const settings = await getDocumentSettings(textDocument.uri);

		// The validator creates diagnostics for all uppercase words length 2 and more
		const text = textDocument.getText();
		const pattern = /\b[A-Z]{2,}\b/g;
		let m: RegExpExecArray | null;

		let problems = 0;
		const diagnostics: Diagnostic[] = [];
		while ((m = pattern.exec(text))) {
			problems++;
			const range = {
					start: textDocument.positionAt(m.index),
					end: textDocument.positionAt(m.index + m[0].length)
				};
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				range,
				message: `${m[0]} is all uppercase.`,
				source: 'ex',
				...hasDiagnosticRelatedInformationCapability && { relatedInformation: [
					{
						location: {
							uri: textDocument.uri,
							range: {...range},
						},
						message: 'Spelling matters'
					},
					{
						location: {
							uri: textDocument.uri,
							range: {...range},
						},
						message: 'Particularly for names'
					}
				]}
			};
			diagnostics.push(diagnostic);
		}

		// Send the computed diagnostics to VSCode.
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
	}

	connection.onDidChangeWatchedFiles(_change => {
		// Monitored files have change in VSCode
		connection.console.log('We received a file change event');
	});

	// FIXME: need to force set the user's  "editor.quickSuggestions": { "strings" }
	// or have a button to help them do it


	// This handler provides the initial list of the completion items.
	connection.onCompletion(
		async (docPos: TextDocumentPositionParams): Promise<CompletionItem[]> => {
			const fullDoc = documents.get(docPos.textDocument.uri)!;
			const offset = fullDoc.offsetAt(docPos.position);
			const text = fullDoc.getText();
			const suggestions = await suggestionsPromise;
			return suggestQueryEditInDocument(suggestions, text, offset);
		}
	);

	// TODO: use this sample for performance maybe... not sure it's more performant in our case
	// This handler resolves additional information for the item selected in
	// the completion list.
	/*
	connection.onCompletionResolve(
		async (item: CompletionItem): CompletionItem => {
			if (item.data === 1) {
				item.detail = 'TypeScript details';
				item.documentation = 'TypeScript documentation';
			} else if (item.data === 2) {
				item.detail = 'JavaScript details';
				item.documentation = 'JavaScript documentation';
			}
			return item;
		}
	);
	*/

	// Make the text document manager listen on the connection
	// for open, change and close text document events
	documents.listen(connection);

	// Listen on the connection
	connection.listen();
}

if (module === require.main)
	main();