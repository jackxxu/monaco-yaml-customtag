define([], function () {
  const tagRegex = /!([A-Z][a-zA-Z0-9]+)?/g;
  const regexWithoutG = new RegExp(tagRegex.source);
  const ajv = new window.ajv7();
  const parser = (yamlString) => { try { return YAML.parse(yamlString); } catch (e) { return null; }};

  const findWhitespaceOrEnd = (str, startPosition) => {
    const regex = /\s|{|}|$/g; // Matches any whitespace character or curly braces or end of the line
    regex.lastIndex = startPosition;

    const match = regex.exec(str);

    if (match) {
      return match.index;
    } else {
      return -1; // Indicates that no whitespace or end of line was found after the startPosition
    }
  }

  const getPositionInfo = (yamlString, line, column) => {
    const lines = yamlString.split('\n');
    const currentLine = lines[line - 1];
    const targetLine = currentLine.slice(0, findWhitespaceOrEnd(currentLine, column-1));

    // Regex to match custom tags and keys
    const keyRegex = /(\w+):/g;

    let customTag = null;
    let closestKey = null;

    // Find the closest custom tag or key
    let match;
    let tagIndex = 0;
    while ((match = tagRegex.exec(targetLine)) !== null) {
      customTag = match[1];
      tagIndex = match.index;
    }

    if (customTag === null) { // if the custom tag is not found in the target line
      // Use a while loop to step back one line at a time until we find a custom tag
      let i = line - 2;
      while (i >= 0) {
        const lineContent = lines[i];
        while ((match = tagRegex.exec(lineContent)) !== null) {
          customTag = match[1];
        }
        if (customTag !== null) break;
        i--;
      }
    }

    // Find the closest key, which has to be on the current line if present
    while ((match = keyRegex.exec(targetLine.slice(tagIndex))) !== null) {
      closestKey = match[1];
    }

    return { customTag, closestKey };
  };

  // returns a list of custom tags based on
  const findCustomTags = (yamlString) => {
    const lines = yamlString.split(/\r?\n/); // Handle both Unix and Windows line endings
    const matches = [];
    let currentIndentation = 0;

    lines.forEach((line, lineNum) => {
      let match;

      while ((match = regex.exec(line)) !== null) { // loop through all the matches in the line
        const customTag = match[1];
        const startColumnNum = match.index + 1;
        let endColumnNum; // the end column number is exclusive and is based on {}

        if (line.indexOf('{', match.index) !== -1) {
          let stack = [];
          let i = match.index;

          while (i < line.length) {
            if (line[i] === '{') {
              stack.push('{');
            } else if (line[i] === '}') {
              stack.pop();

              if (stack.length === 0) {
                endColumnNum = i + 1;
                break;
              }
            }
            i++;
          }
        }

        let body = null;
        let obj = null;
        if (endColumnNum === undefined) { // if no {} for the body of the tag
          endColumnNum = line.length;
          obj = null;
        } else {
          body = line.substring(startColumnNum + customTag.length + 1, endColumnNum);
          // remove ! in the body
          body = body.replace(regexWithoutG, '');
          obj = parser(body);
        }

        matches.push({ customTag, lineNum: lineNum + 1, startColumnNum, endColumnNum, body: body, obj: obj});
      }
    });

    // for each match that doesn't have a body, starting from its line number, find the next line that has the same indentation
    // and use that as the body
    matches.forEach((match, index) => {
      if (match.body === null) {
        const lineNum = match.lineNum;
        const startColumnNum = match.startColumnNum;
        const endColumnNum = match.endColumnNum;
        const customTag = match.customTag;
        const currentIndentation = startColumnNum - 1;
        let body = '';
        let obj = null;

        for (let i = lineNum; i < lines.length; i++) {
          const line = lines[i];
          const indentation = line.search(/\S|$/);
          if (indentation <= currentIndentation) {
            // remove all the custom tags in the body
            body = body.replace(regex, '');
            obj = parser(body);
            matches[index].body = body;
            matches[index].obj = obj;
            break;
          } else {
            body += line + '\n';
          }
        }
      }
    });

    return matches;
  };

  const suggestionSnippet = function(text) {
    return {
      label: '!' + text,
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: text,
    };
  }

  const suggestionKey = function(key) {
    return {
      label: key,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText: ' ' + key
    };
  };

  const suggestionValue = function(value) {
    return {
      label: value,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: ' ' + value
    };
  };

  const textBeforeCursor = function(model, position) {
    return model.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: position.column - 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    });
  };

  function createYamlCompletionProvider(tagSchemas) {
    const snippets = Object.entries(tagSchemas).map(([name, value]) => `${name} {${(value.required || []).map(x => x + ': ').join(', ')}}`);
    return {
      triggerCharacters: ['!', ',', ':'],

      provideCompletionItems: function (model, position) {
        let textBefore = textBeforeCursor(model, position);

        let suggestions = [];
        if (textBefore === '!') {
          suggestions = snippets.map(suggestionSnippet)
        }

        if ((textBefore === ',') || (textBefore === '{')) {
          let positionInfo = getPositionInfo(model.getValue(), position.lineNumber, position.column);
          const word = positionInfo.customTag;
          const schema = tagSchemas[word];
          suggestions = Object.keys(schema.properties).map(suggestionKey)
        }

        if (textBefore === ':') {
          // to be refactored
          let positionInfo = getPositionInfo(model.getValue(), position.lineNumber, position.column);
          const word = positionInfo.customTag;
          const schema = tagSchemas[word];
          if ((schema.properties[positionInfo.closestKey].type ?? '') == 'boolean') {
            suggestions = ['true', 'false'].map(suggestionValue)
          }
        }

        return {suggestions: suggestions};
      }
    }
  }

  function createYamlHoverProvider(tagSchemas) {
    return {
      provideHover: function (model, position) {
        const wordAtPosition = model.getWordAtPosition(position);
        let positionInfo = getPositionInfo(model.getValue(), position.lineNumber, position.column);
        if (positionInfo) {
          const word = positionInfo.customTag;
          const meaning = tagSchemas[word]['description'];

          if (meaning) {
            return {
              contents: [
                { value: `**${word}**` },
                { value: meaning },
              ],
              range: wordAtPosition
            };
          }
        }
        return null;
      }
    };
  }

  const tagSchemasObject = function(schemas) {
    const keyAttribute = 'name';
    return schemas.reduce((acc, obj) => {
      const key = obj[keyAttribute];
      // Create a copy of the object without the specified attribute
      const { [keyAttribute]: _, ...rest } = obj;
      acc[key] = rest;
      return acc;
    }, {});
  };

  const configureMonacoCustomTags = function(schemas, editor) {
    console.log('configureMonacoCustomTags', schemas);
    console.log('configureMonacoCustomTags', editor);
    const tagSchemas = tagSchemasObject(schemas);
    monaco.languages.registerCompletionItemProvider('yaml', createYamlCompletionProvider(tagSchemas));
    monaco.languages.registerHoverProvider('yaml', createYamlHoverProvider(tagSchemas));

    editor.onDidChangeCursorPosition(function (event) {
      const currentPosition = event.position;
      const model = editor.getModel();
      let positionInfo = getPositionInfo(model.getValue(), currentPosition.lineNumber, currentPosition.column);

      if (positionInfo) {
        const word = positionInfo.customTag;
        const schema = tagSchemas[word];
        if (textBeforeCursor(model, currentPosition) === '{') {
          editor.trigger('{', 'editor.action.triggerSuggest', {});
        }
      }
    });

  };

  return configureMonacoCustomTags;
});