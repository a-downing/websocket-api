// http://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  parser: 'babel-eslint',
  parserOptions: {
    sourceType: 'module'
  },
  env: {
    browser: true,
  },
  // https://github.com/feross/standard/blob/master/RULES.md#javascript-standard-style
  extends: 'standard',
  // required to lint *.vue files
  plugins: [
    'html',
    'import'
  ],
  // add your custom rules here
  'rules': {
    // allow paren-less arrow functions
    'arrow-parens': 0,
    // allow async-await
    'generator-star-spacing': 0,
    // allow debugger during development
    'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,
    "indent": 0,
    "eqeqeq": 0,
    "keyword-spacing": 0,
    "space-before-function-paren": 0,
    "no-unused-vars": 0,
    "import/no-unresolved": 2,
    "spaced-comment": 0,
    "no-trailing-spaces": 0,
    "no-unneeded-ternary": 0,
    "no-unexpected-multiline": 0,
    "camelcase": 0,
    "no-callback-literal": 0
  }
}
