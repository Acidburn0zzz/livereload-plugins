"use strict";

var assert = require("assert");
var core = require("./core");
var error = require("./../lib/error");

function getline(node) {
	return node.loc.start.line;
}

function isVarConstLet(kind) {
	return kind === "var" || kind === "const" || kind === "let";
}

function isObjectPattern(node) {
	return node && node.type == 'ObjectPattern';
}

function isArrayPattern(node) {
	return node && node.type == 'ArrayPattern';
}

function isForInOf(node) {
	return node && (node.type === "ForInStatement" || node.type === "ForOfStatement");
}

var plugin = module.exports = {
	reset: function() {

	}

	, setup: function(alter, ast, options) {
		if( !this.__isInit ) {
			this.reset();
			this.__isInit = true;
		}

		this.alter = alter;
		this.options = options;
	}

	, ':: ObjectPattern,ArrayPattern': function replaceDestructuringVariableDeclaration(node) {
		var parentNode, declarationNode;

		{
			parentNode = node.$parent;

			if( parentNode.type === "VariableDeclarator" ) {
				declarationNode = parentNode.$parent;
				if( isForInOf(declarationNode.$parent) ) {
					//TODO::
				}
				else if( isVarConstLet(declarationNode.kind) ) {
					this.__replaceDeclaration(parentNode, node);
				}
			}
			else if( parentNode.type === "AssignmentExpression" ) {
				this.__replaceAssignment(parentNode, node);
			}
		}
	}

	, __replaceDeclaration: function replaceDeclaration(declarator, declaratorId) {
		var declaratorInit = declarator.init;

		if( declaratorInit == null ) {
			error(getline(declarator), "destructuring must have an initializer");
			return;
		}

		var declarationString = this.unwrapDestructuring("var", declaratorId, declaratorInit);

		var isFirstVar = declarationString.substring(0, 4) === "var ";

		// replace destructuring with simple variable declaration
		this.alter.replace(
			declarator.range[0]
			, declarator.range[1]
			, (isFirstVar ? declarationString.substr(4) : declarationString)//remove first "var " if needed
		);
	}

	, __replaceAssignment: function(assignment, assignmentLeft) {
		var assignmentRight = assignment.right;

		var declarationString = this.unwrapDestructuring("", assignmentLeft, assignmentRight);

		// replace destructuring with simple variable assignment
		this.alter.replace(
			assignment.range[0]
			, assignment.range[1]
			, declarationString
		);
	}

	, unwrapDestructuring: function unwrapDestructuring(kind, definitionNode, valueNode, newVariables, newDefinitions) {
		var _isObjectPattern = isObjectPattern(definitionNode);

		assert(_isObjectPattern || isArrayPattern(definitionNode));
		if( !newVariables )newVariables = [];
		assert(Array.isArray(newVariables));

		if( (_isObjectPattern ? definitionNode.properties : definitionNode.elements).length === 0 ) {
			// an empty destructuring
			var temporaryVarName = core.getScopeTempVar(definitionNode, definitionNode.$scope.closestHoistScope());
			core.setScopeTempVar(temporaryVarName, definitionNode, definitionNode.$scope.closestHoistScope());
			return temporaryVarName;
		}

		newDefinitions = newDefinitions || [];

		this.__unwrapDestructuring(kind === "var" ? 1 : 0, definitionNode, valueNode, newVariables, newDefinitions);

		kind = (kind ? kind + " " : "");

		var destructurisationString = kind;

		var needsFirstComma = false;

		for(var index = 0, len = newDefinitions.length ; index < len ; index++ ){
			var definition = newDefinitions[index];

			// inherit scope from original VariableDefinitions node
			definition.$scope = definitionNode.$scope;

			assert( definition.type === "VariableDeclarator" );

			var delimiter = void 0;
			if( needsFirstComma ) {
				delimiter = ", ";
				needsFirstComma = false;
			}
			else {
				delimiter = "";
			}

			assert( typeof definition["$raw"] === "string" );//"$raw" defined in this.__unwrapDestructuring

			destructurisationString += ( delimiter + definition["$raw"] );

			if( definition["$assignmentExpressionResult"] === true ) {
				var $parent = valueNode.$parent;
				if( $parent && ($parent = $parent.$parent) && ($parent = $parent.$parent) && $parent.type === "ExpressionStatement" ) {
					var isExpressionStatementWithoutBrackets = this.alter.getRange(valueNode.range[1], valueNode.$parent.$parent.range[1]) !== ')';

					if( isExpressionStatementWithoutBrackets ) {
						destructurisationString = '(' + destructurisationString + ')';
					}
				}
			}

			needsFirstComma = true;
		}

		return destructurisationString;
	}

	, __unwrapDestructuring: function(type, definitionNode, valueNode, newVariables, newDefinitions, hoistScope) {
		var isTemporaryVariable = false, valueIdentifierName, temporaryVariableIndexOrName, valueIdentifierDefinition;
		var isTemporaryValueAssignment = false;

		var _isObjectPattern = isObjectPattern(definitionNode)
			, valueNode_isArrayPattern = isArrayPattern(valueNode)
			, valueNode_isObjectPattern = isObjectPattern(valueNode)
			, elementsList = _isObjectPattern ? definitionNode.properties : definitionNode.elements
			, localFreeVariables
			, isLocalFreeVariable = type === 1
		;

		if( isLocalFreeVariable || valueNode_isArrayPattern || valueNode_isObjectPattern ) {
			//TODO:: tests
			//TODO:: get only last variable name
			localFreeVariables = core.getNodeVariableNames(definitionNode);
		}

		if( typeof valueNode["$raw"] === "string" ) {
			valueIdentifierName = valueNode["$raw"];

			if( valueIdentifierName.indexOf("[") !== -1 || valueIdentifierName.indexOf(".") !== -1 ) {
				isTemporaryVariable = true;
				valueIdentifierDefinition = valueIdentifierName;
			}
		}
		else if( valueNode.type === "Identifier" ) {
			valueIdentifierName = valueNode.name;

			if( valueIdentifierName.indexOf("[") !== -1 || valueIdentifierName.indexOf(".") !== -1 ) {
				isTemporaryVariable = true;
				valueIdentifierDefinition = valueIdentifierName;
			}
		}
		else {
			isTemporaryVariable = true;

			if( valueNode_isArrayPattern || valueNode_isObjectPattern ) {
				valueIdentifierDefinition = localFreeVariables.pop();
			}
			else {
				var isSequenceExpression = valueNode.type === "SequenceExpression";
				valueIdentifierDefinition = (isSequenceExpression ? "(" : "") + this.alter.get(valueNode.range[0], valueNode.range[1]) + (isSequenceExpression ? ")" : "");
			}

		}

		if( isTemporaryVariable ) {
			if( valueNode.type === "Identifier" || isLocalFreeVariable ) {
				if( elementsList.length < 2 ) {
					isTemporaryVariable = false;
				}

				if( isTemporaryVariable === false ) {
					if( valueIdentifierDefinition.charAt(0) !== "(") {
						valueIdentifierName = "(" + valueIdentifierDefinition + ")";
					}
					else {
						valueIdentifierName = valueIdentifierDefinition;
					}
				}
			}
		}

		if( isTemporaryVariable ) {
			if( isLocalFreeVariable ) {
				valueIdentifierName = localFreeVariables.pop();
			}
			else {
				valueIdentifierName = null;
			}

			if( !valueIdentifierName ) {
				isLocalFreeVariable = false;
				if( !hoistScope ) {
					hoistScope = definitionNode.$scope.closestHoistScope();
				}

				valueIdentifierName = core.getScopeTempVar(definitionNode, hoistScope);
			}
			else {
				isLocalFreeVariable = true;
			}

			temporaryVariableIndexOrName = valueIdentifierName;
			valueIdentifierName = "(" + valueIdentifierName + " = " + valueIdentifierDefinition + ")";
			isTemporaryValueAssignment = true;
		}

		for( var k = 0, len = elementsList.length ; k < len ; k++ ) {
			var element = elementsList[k], elementId = _isObjectPattern ? element.value : element;
			if (element) {
				if( isObjectPattern(elementId) || isArrayPattern(elementId) ) {
					this.__unwrapDestructuring(
						1
						, _isObjectPattern ? element.value : element
						, {
							type: "Identifier"
							, name: valueIdentifierName + (_isObjectPattern ? core.PropertyToString(element.key) : ("[" + k + "]"))
						}
						, newVariables
						, newDefinitions
						, hoistScope
					);
				}
				else {
					var renamingOptions = elementId.$renamingOptions;
					if( renamingOptions ) {// turn off changes were made by 'letConst' transpiler
						renamingOptions.inactive = true;
					}

					var newDefinition = {
						"type": "VariableDeclarator",
						"id": elementId,
						"init": {
							"type": "MemberExpression",
							"computed": false,
							"object": {
								"type": "Identifier",
								"name": valueIdentifierName
							}
						}
					};
					newDefinition.$scope = definitionNode.$scope;

					if( _isObjectPattern ) {
						newDefinition["init"]["property"] = element.key;
					}
					else {
						newDefinition["computed"] = true;
						newDefinition["init"]["property"] = {
							"type": "Literal",
							"value": k,
							"raw": k + ""
						}
					}

//					TODO::
//					if( type === 0 ) {
//						newDefinition["type"] = "AssignmentExpression";
//						newDefinition["left"] = newDefinition["id"];
//						delete newDefinition["id"];
//						newDefinition["right"] = newDefinition["init"];
//						delete newDefinition["init"];
//					}

					if( element.type === "SpreadElement" ) {
						newDefinition["$raw"] = core.unwrapRestDeclaration(element.argument, valueIdentifierName, k);
					}
					else {
//						if( type === 1 ) {//VariableDeclarator
							newDefinition["$raw"] = core.VariableDeclaratorString(newDefinition);
//						}
//						else {//AssignmentExpression
//							newDefinition["$raw"] = core.AssignmentExpressionString(newDefinition);
//						}
					}

					newDefinitions.push(newDefinition);
				}

				if( isTemporaryValueAssignment ) {
					valueIdentifierName = temporaryVariableIndexOrName;
					isTemporaryValueAssignment = false;
				}
			}
		}

		if( type === 0 ) {//AssignmentExpression
			newDefinitions.push({
				"type": "VariableDeclarator"
				, "$raw": temporaryVariableIndexOrName || valueIdentifierName
				, "$assignmentExpressionResult": true
			});
		}

		assert(!isTemporaryValueAssignment);

		if( !isLocalFreeVariable && isTemporaryVariable && temporaryVariableIndexOrName != void 0 ) {
			core.setScopeTempVar(temporaryVariableIndexOrName, valueNode, hoistScope, true);
		}
	}
};

for(var i in plugin) if( plugin.hasOwnProperty(i) && typeof plugin[i] === "function" ) {
	plugin[i] = plugin[i].bind(plugin);
}
