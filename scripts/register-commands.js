// One-time script to register slash commands with Discord
// Run: DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register-commands.js

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN  = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !TOKEN) {
  console.error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN env vars before running.');
  process.exit(1);
}

const commands = [
  {
    name: 'leaderboard',
    description: 'Show the current Race to Masters standings'
  },
  {
    name: 'points',
    description: 'Check your Gamba points balance'
  },
  {
    name: 'bet',
    description: 'Gamba betting commands',
    options: [
      {
        name: 'create',
        description: 'Create a new bet',
        type: 1, // SUB_COMMAND
        options: [
          { name: 'title', description: 'Short title for the bet', type: 3, required: true },
          { name: 'description', description: 'Optional longer description or conditions', type: 3, required: false }
        ]
      },
      {
        name: 'join',
        description: 'Join an existing bet',
        type: 1,
        options: [
          { name: 'id', description: 'Bet ID (shown in /bet list)', type: 3, required: true },
          { name: 'choice', description: 'Your choice (e.g. "yes", "no", a player name)', type: 3, required: true },
          { name: 'amount', description: 'Points to wager (default 100)', type: 4, required: false }
        ]
      },
      {
        name: 'list',
        description: 'List all open bets',
        type: 1
      },
      {
        name: 'resolve',
        description: 'Resolve a bet and pay out winners (bet creator only)',
        type: 1,
        options: [
          { name: 'id', description: 'Bet ID', type: 3, required: true },
          { name: 'winner', description: 'The winning choice string', type: 3, required: true }
        ]
      }
    ]
  }
];

async function register() {
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: 'PUT', // PUT replaces all global commands at once
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Failed to register commands:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`Registered ${data.length} commands:`);
  data.forEach(c => console.log(`  /${c.name} (${c.id})`));
  console.log('\nDone. Set your app\'s Interactions Endpoint URL to:');
  console.log('  https://<your-vercel-url>/api/discord-interactions');
}

register().catch(err => { console.error(err); process.exit(1); });
