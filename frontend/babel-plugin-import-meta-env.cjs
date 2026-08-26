// Локальный babel-плагин: заменяет import.meta на { env: process.env }.
//
// Vite подставляет import.meta.env на этапе сборки, а Jest прогоняет тот же код
// через babel как CommonJS — конструкция доживала до рантайма и падала с
// «SyntaxError: Cannot use 'import.meta' outside a module». Из-за этого набор
// Layout.test.jsx не запускался целиком.
//
// Переменные VITE_* в тестах берутся из process.env, что позволяет задавать их
// в src/tests/setup.js.
module.exports = function importMetaEnv({ types: t }) {
  return {
    name: 'import-meta-env-to-process-env',
    inherits: require('@babel/plugin-syntax-import-meta').default,
    visitor: {
      MetaProperty(path) {
        if (path.node.meta && path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWith(
            t.objectExpression([
              t.objectProperty(
                t.identifier('env'),
                t.memberExpression(t.identifier('process'), t.identifier('env'))
              ),
            ])
          );
        }
      },
    },
  };
};
