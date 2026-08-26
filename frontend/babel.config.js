export default {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }]
  ],
  plugins: [
    // Нужен только под Jest: Vite сам подставляет import.meta.env при сборке
    './babel-plugin-import-meta-env.cjs'
  ]
};
