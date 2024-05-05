import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ImportRange = 'Import!A3';
const SpreadsheetId = '1iOMYE_g6BcrshbD7h49ba7LEQCLgm0jC0TrQAZWkgkg';

(async () => {
	const googleClient = new google.auth.JWT(
		process.env.GOOGLE_CLIENT_EMAIL,
		undefined,
		process.env.GOOGLE_CLIENT_KEY.replace(/\\n/g, '\n'),
		['https://www.googleapis.com/auth/spreadsheets'],
	);
	await googleClient.authorize();
	const sheets = google.sheets({ version: 'v4', auth: googleClient });

	async function pushToSheet(rows) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SpreadsheetId,
			range: ImportRange,
			valueInputOption: 'USER_ENTERED',
			resource: { values: rows },
		})
		await sheets.spreadsheets.values.update({
			spreadsheetId: SpreadsheetId,
			range: 'Import!B1',
			valueInputOption: 'USER_ENTERED',
			resource: { values: [['Auto-sync: ' + new Date().toLocaleString()]] },
		})
	}

	// start puppeteer and pull data
	console.log("Pulling data...");
	let rows;
	const browser = await puppeteer.launch();
	try {
		const page = await browser.newPage();
		await page.goto('https://lcr.churchofjesuschrist.org/records/member-list?lang=eng&households');

		const username = await page.waitForSelector('input[name="identifier"]');
		await username.type(process.env.LDS_USERNAME);

		const next = await page.waitForSelector('input[type="submit"]');
		await next.click();

		const pw = await page.waitForSelector('input[type="password"]');
		await pw.type(process.env.LDS_PASSWORD);

		const verify = await page.waitForSelector('input[type="submit"]');
		await verify.click();

		await page.waitForSelector('text/Leader and Clerk Resources');
		await page.goto('https://lcr.churchofjesuschrist.org/records/member-list?lang=eng&households');
		await page.waitForSelector('text/Household Members');

		const houseSelector = 'tr[ng-class="{alt: member.alt}"]';

		// scroll to load all households
		let count = 0;
		let iterations = 0;
		while (true) {
			if (iterations++ > 10) break;
			const rows = await page.$$(houseSelector);
			if (count === rows.length) break;
			count = rows.length;
			await rows[rows.length - 1].click();
			await wait(1000);
		};

		rows = await page.evaluate(() => {
			const houseSelector = 'tr[ng-class="{alt: member.alt}"]';
			let rows = [];
			document.querySelectorAll(houseSelector).forEach(householdRow => {
				let houseName = householdRow.querySelector('td.n.fn member-card + span').innerText;
				let address = householdRow.querySelector('td[ng-class*="showAddress"]').innerText.replaceAll('\n', ' ');
				let names = Array.from(householdRow.querySelectorAll('div[ng-repeat*="householdMembers"] a')).map(name => name.innerText);
				rows.push([houseName, names.reduce((l,n)=>l+n+"\\n", ""), address]);
			})
			return rows;
		});
	}
	catch (e) {
		console.log("Error during puppeteer execution:");
		console.log(e)
		await browser.close();
		return;
	}

	await browser.close();

	console.log(`Found ${rows.length} rows.`);
	console.log('1:', rows[0]);
	console.log('...');
	console.log(`${rows.length}:`, rows[rows.length - 1]);
	
	if (process.env.SETTINGS === 'production') {
		// First empty the entire import range
		const emptyRows = Array(300).fill(['', '', '']);
		await pushToSheet(emptyRows);
		await pushToSheet(rows);
		console.log("Pushed to sheet.");
	}
	else {
		console.log("Skipping push to sheet.");
	}
})();
