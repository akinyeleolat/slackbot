// index.js
// Initialize using signing secret from environment variables
const dotenV = require('dotenv')

dotenV.config()
const { createEventAdapter } = require('@slack/events-api');
const { WebClient } = require('@slack/web-api');
const { tablize } = require('batteries-not-included/utils');
const { MongoClient } = require('mongodb');

const token = process.env.OAUTH_TOKEN;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;

const slackEvents = createEventAdapter(slackSigningSecret);
const web = new WebClient(token);
// Grab the MongoDB password and username we stored in our env file
const mongoPass = process.env.MONGOPASS;
const mongoUser = process.env.MONGOUSER;
const mongoDB = process.env.DB_NAME;
const dbUri= process.env.DB_URI;
const uri = dbUri || `mongodb+srv://${mongoUser}:${mongoPass}@cluster0-xxxxx.mongodb.net/${mongoDB}?retryWrites=true&w=majority`;

const port = process.env.PORT || 3000;

const dbClient = new MongoClient(uri, { useNewUrlParser: true });

// Connect to Mongo server instance
dbClient.connect(err => {
	// Show any errors that showup in the 
	if (err) console.error(err);
  // Connect to the test database in a cluster. Connect to the scores collection in that database
	const collection = dbClient.db('test').collection('scores');

	const getIsPlusOrMinus = str => {
		const plusOrMinusRegex = /\@(\w+?)(\-{2}|\+{2}|\—{1})/;
		const [, itemToScore, scoreStr] = plusOrMinusRegex.exec(str) || [];
		switch (scoreStr) {
			case '--':
			case '—':
				return { action: 'minus', word: itemToScore };
			case '++':
				return { action: 'add', word: itemToScore };
			default:
				return { action: '', word: undefined };
		}
	};


	slackEvents.on('message', async event => {
		try {
			console.log(`Received a message event: user ${event.user} in channel ${event.channel} says ${event.text}`);

			const { action, word } = getIsPlusOrMinus(event.text);
			if (action) {
				const value = action == 'add' ? 1 : -1;

				// Update the document and also return the document's value for us to use
				const doc = await collection.findOneAndUpdate(
					{ word },
					// Add `value` to "count" property. If `-1`, then remove one from "count"
					{ $inc: { count: value } },
					// `returnOriginal: false` says to return the updated document
					// `upsert` means that if the document doesn't already exist, create a new one
					{ returnOriginal: false, upsert: true }
				);

				const actionString = action == 'add' ? 'had a point added' : 'had a point removed';

				const result = await web.chat.postMessage({
					text: `${doc.value.word} ${actionString}. Score is now at: ${doc.value.count}`,
					channel: event.channel,
				});

				console.log(`Successfully send message ${result.ts} in conversation ${event.channel}`);
			}

			if (/@pointsrus leaderboard/i.exec(event.text)) {
				const topTenCollection = await collection
					// Find ANY document 
					.find({})
					// Sort it from highest to lowest
					.sort({ count: 1 })
					// Limit it to 10 in case there are hundreds of values
					.limit(10)
					// Then, return it as a promise that has an array in it
					.toArray();
				// Mapping the array to display with `tablize`
				const state = topTenCollection.map(doc => {
					return [doc.word, doc.count];
				});
				const tableString = tablize([['Item', 'Count'], ...state]);

				const result = await web.chat.postMessage({
					text: '```\n' + tableString + '```',
					channel: event.channel,
				});

				console.log(`Successfully send message ${result.ts} in conversation ${event.channel}`);
			}
		} catch (e) {
			console.error(e);
		}
	});

	slackEvents.on('error', console.error);

	slackEvents.start(port).then(() => {
		console.log(`server listening on port ${port}`);
	});
});