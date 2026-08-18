#!/usr/bin/env node

/**
 * Script para rodar Bot + Servidor Web simultaneamente
 * Uso: npm run dev
 */

require('dotenv').config();
const { spawn } = require('child_process');

console.log('\n🚀 Iniciando Bot Discord + Servidor Web...\n');

// Inicia Bot (index.js)
const bot = spawn('node', ['index.js'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

// Inicia Servidor Web (server.js)
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

// Se um deles encerrar, fecha ambos
bot.on('exit', (code) => {
  console.log(`\n❌ Bot encerrou com código ${code}`);
  server.kill();
  process.exit(code);
});

server.on('exit', (code) => {
  console.log(`\n❌ Servidor web encerrou com código ${code}`);
  bot.kill();
  process.exit(code);
});

// Trata Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Encerrando Bot + Servidor...\n');
  bot.kill();
  server.kill();
  process.exit(0);
});
