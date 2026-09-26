#!/usr/bin/env node
// Исправление истории встреч по Битриксу (services/repairHistory.js).
//
//   node src/cli/repairHistory.js --from 2026-08-26 --to 2026-09-26          # проверка, ничего не пишет
//   node src/cli/repairHistory.js --from 2026-08-26 --to 2026-09-26 --apply  # исправить
//   ... --json  — полный отчёт с примерами (ID встреч и лидов, без ПДн)
//
// В контейнере: docker exec -w /app bookmeeting-backend node src/cli/repairHistory.js ...
require('dotenv').config();

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

(async () => {
	const from = arg('from');
	const to = arg('to');
	if (!ISO.test(from || '') || !ISO.test(to || '') || from > to) {
		console.error('Нужны --from и --to в виде YYYY-MM-DD, from ≤ to');
		process.exit(2);
	}
	const { sequelize } = require('../lib/db');
	const { repairHistory } = require('../services/repairHistory');
	const report = await repairHistory({ from, to, dryRun: !args.includes('--apply') });
	if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
	else {
		const { samples, ...summary } = report;
		console.log(JSON.stringify(summary, null, 2));
	}
	await sequelize.close();
	process.exit(0);
})().catch((e) => { console.error('repairHistory failed:', e?.stack || e); process.exit(1); });
