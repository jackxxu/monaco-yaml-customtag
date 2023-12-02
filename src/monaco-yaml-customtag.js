// yaml-extension.js

// Check if Monaco Editor is defined
define([], function () {
    console.log(monaco);
    // Register YAML language
    monaco.languages.register({ id: 'yaml' });

    // Register autocompletion provider
    monaco.languages.registerCompletionItemProvider('yaml', {
      provideCompletionItems: () => {
        return [
          { label: '!customTag1', kind: monaco.languages.CompletionItemKind.Keyword },
          { label: '!customTag2', kind: monaco.languages.CompletionItemKind.Keyword },
        ];
      },
    });

    // Register hover provider
    monaco.languages.registerHoverProvider('yaml', {
      provideHover: (model, position) => {
        const wordAtPosition = model.getWordAtPosition(position);
        if (wordAtPosition) {
          const word = wordAtPosition.word;
          if (word === '!customTag1') {
            return {
              contents: [{ value: 'Description for Custom Tag 1' }],
              range: wordAtPosition.range,
            };
          } else if (word === '!customTag2') {
            return {
              contents: [{ value: 'Description for Custom Tag 2' }],
              range: wordAtPosition.range,
            };
          }
        }
        return null;
      },
    });

    return 123;
  });