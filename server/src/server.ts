/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fse from "fs-extra";
import * as path from "path";
import * as child_process from "child_process";

import * as xml2js from "xml2js";
import * as TreeSitter from "tree-sitter";
import * as TreeSitterSql from "tree-sitter-sql";

const parser = new TreeSitter();
parser.setLanguage(TreeSitterSql);

export interface SelectStatementMatch {
	select: TreeSitter.SyntaxNode;
	from: TreeSitter.SyntaxNode;
	joins: TreeSitter.SyntaxNode[];
	tables: string[];
}

// TODO: may want to suggest tables when there is an error after a FROM
export const selectStatementsQuery = new TreeSitter.Query(
	TreeSitterSql,
	"(select_statement (from_clause (identifier) @from-name)? @from (join_clause . (identifier) @join-name)* @joins) @select"
);

export function getCurrentSelectStatement(cursorOffsetInSql: number, queryInSource: QueryLoc): SelectStatementMatch | undefined {
	const matches = selectStatementsQuery.matches(queryInSource.ast.rootNode);
	const current = matches.reduce(
		(prev, match) =>
		match.captures[0/*select*/].node.startIndex <= cursorOffsetInSql
		&& match.captures[0/*select*/].node.endIndex >= cursorOffsetInSql
		? (!prev || (match.captures[0/*select*/].node.startIndex >= prev.captures[0/*select*/].node.startIndex
								&& match.captures[0/*select*/].node.endIndex <= prev.captures[0/*select*/].node.endIndex)
				? match
				: prev)
			: undefined,
		undefined as TreeSitter.QueryMatch | undefined
	);
	return current && {
		select: current.captures[0/*select*/].node,
		from: current.captures[1/*from*/].node,
		joins: current.captures.filter(c => c.name === 'joins').map(c => c.node),
		tables: [
			current.captures[2/*from-name*/].node.text!,
			...current.captures.filter(c => c.name === 'join-name').map(c => c.node.text!),
		]
	};
}

export const columnsQuery = new TreeSitter.Query(TreeSitterSql, "(select_clause_body [(identifier) (alias)] @col)");

interface QueryLoc {
	start: number;
	end: number;
	ast: TreeSitter.Tree;
}

function findAllQueries(doc: TextDocument): QueryLoc[] {
	const text = doc.getText();
	const results: QueryLoc[] = [];
	for (const match of text.matchAll(/(i[mM]odel|[dD]b)\.(query|withPreparedStatment)\(/g)) {
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
				ast,
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
	return /".*(?<!\\)"/.exec(text.slice(offset))?.[0] ?? undefined;
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

const cachedBisSchemaRepoPath = path.join(__dirname, "bis-schemas-cache");

type ECPropertyType = string;

interface Suggestions {
	schemas: {
		[schemaName: string]: {
			[className: string]: {
				[propertyName: string]: any;
			}
		}
	}
}

function main() {
	if (!fse.existsSync(cachedBisSchemaRepoPath)) {
		// TODO: make git path configurable or something
		console.log("caching Bis-Schemas repo");
		child_process.execFileSync("git", ["clone", "https://github.com/iTwin/bis-schemas", cachedBisSchemaRepoPath]);
		console.log("done caching Bis-Schemas repo");
	} else {
		console.log(`found existing cached Bis-Schemas repo at: ${cachedBisSchemaRepoPath}`);
	}

	async function buildSuggestions() {
		const suggestions: Suggestions = { schemas: {} };

		const xmlParser = new xml2js.Parser();
		// in the future read all unversioned .ecschema.xml files in the repo
		const bisCoreSchemaPath = path.join(cachedBisSchemaRepoPath, "Domains/Core/BisCore.ecschema.xml")
		const bisCoreSchemaText = fse.readFileSync(bisCoreSchemaPath).toString();
		const bisCoreSchemaXml = await xmlParser.parseStringPromise(bisCoreSchemaText);
		suggestions.schemas.BisCore = {};

		const unresolvedClasses = new Map<string, any>(bisCoreSchemaXml.ECSchema.ECEntityClass.map((xml: any) => [xml.$.typeName, xml]));
		const resolvedClasses = new Map<string, any>();

		function resolveClass(className: string) {
			if (resolvedClasses.has(className)) return;
			const classXml = unresolvedClasses.get(className);
			for (const baseClassName of classXml?.BaseClass ?? []) {
				if (!resolvedClasses.has(baseClassName)) resolveClass(baseClassName);
			}
			const classSuggestions: Suggestions["schemas"][string][string] = {};
			for (const xmlPropType of ["ECProperty", "ECStructProperty", "ECNavigationProperty", "ECArrayProperty"]) {
				for (const prop of classXml?.[xmlPropType] ?? []) {
					classSuggestions[prop.$.propertyName] = prop;
				}
			}
			suggestions.schemas.BisCore[className] = classSuggestions;
			resolvedClasses.set(className, classSuggestions);
			unresolvedClasses.delete(className);
		}

		for (const className of unresolvedClasses.keys()) {
			resolveClass(className)
		}

		return suggestions;
	}

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
					/*
					triggerCharacters: [
						...new Array(26).fill(undefined).map((_, i) => String.fromCharCode('a'.charCodeAt(0) + i)),
						...new Array(26).fill(undefined).map((_, i) => String.fromCharCode('A'.charCodeAt(0) + i))
					],
					*/
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

	// The example settings
	interface ExampleSettings {
		maxNumberOfProblems: number;
		fallbackIModelUrl: string;
	}

	// The global settings, used when the `workspace/configuration` request is not supported by the client.
	// Please note that this is not the case when using this server with the client provided in this example
	// but could happen with other clients.
	const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000, fallbackIModelUrl: "" };
	let globalSettings: ExampleSettings = defaultSettings;

	// Cache the settings of all open documents
	const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

	connection.onDidChangeConfiguration(change => {
		if (hasConfigurationCapability) {
			// Reset all cached document settings
			documentSettings.clear();
		} else {
			globalSettings = <ExampleSettings>(
				(change.settings.languageServerExample || defaultSettings)
			);
		}

		// Revalidate all open text documents
		documents.all().forEach(validateTextDocument);
	});

	function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
		if (!hasConfigurationCapability) {
			return Promise.resolve(globalSettings);
		}
		let result = documentSettings.get(resource);
		if (!result) {
			result = connection.workspace.getConfiguration({
				scopeUri: resource,
				section: 'languageServerExample'
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
	documents.onDidChangeContent(change => {
		validateTextDocument(change.document);
	});

	async function validateTextDocument(textDocument: TextDocument): Promise<void> {
		// In this simple example we get the settings for every validate run.
		const settings = await getDocumentSettings(textDocument.uri);

		// The validator creates diagnostics for all uppercase words length 2 and more
		const text = textDocument.getText();
		const pattern = /\b[A-Z]{2,}\b/g;
		let m: RegExpExecArray | null;

		let problems = 0;
		const diagnostics: Diagnostic[] = [];
		while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
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

			const queries = await findAllQueries(fullDoc);
			if (queries.length === 0) return [];

			const offset = fullDoc.offsetAt(docPos.position);
			const queryWeAreIn = queries.find(q => q.start <= offset && q.end >= offset);
			if (queryWeAreIn === undefined) return [];

			const currSelect = getCurrentSelectStatement(offset, queryWeAreIn);

			const docText = fullDoc.getText();
			const textBehindPos = docText.slice(0, offset);
			const currentWordMatch = /\w+$/.exec(textBehindPos);
			const currentWord = currentWordMatch?.[0] ?? "";
			const suggestions = await suggestionsPromise;

			const result: CompletionItem[] = [];
			let limit = 100;

			outer: for (const schemaName in suggestions.schemas) {
				const schema = suggestions.schemas[schemaName];
				for (const className in schema) {
					const class_ = schema[className];
					for (const propertyName in class_) {
						if (!propertyName.startsWith(currentWord)) continue;
						const property = class_[propertyName];
						result.push({
							label: propertyName,
							insertText: propertyName,
							kind: CompletionItemKind.Field,
							data: `${schemaName}.${className}.${propertyName}`, // use lodash.get if doing this?
							detail: property.$.extendedTypeName ?? "no extended type",
							documentation: property.$.description,
						});
						limit--;
						if (limit === 0) break outer;
					}
				}
			}
			return result;
		}
	);

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