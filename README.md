# Levi Urgent 1.0 🤖
Solana Memecoin Scanner & Trading Bot

## Setup Instructions

### Step 1 — Install dependencies
Open Terminal in this folder and run:
```
npm install
```

### Step 2 — Get your Telegram Chat ID
1. Start your bot on Telegram (send it any message)
2. Open this URL in browser (replace YOUR_BOT_TOKEN):
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
3. Find "chat":{"id": 946894357} — that number is your Chat ID

### Step 3 — Test locally first (optional)
Create a .env file (copy from .env.example) and fill in your values:
```
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx  
WALLET_PRIVATE_KEY=xxx
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```
Then run: `npm start`

### Step 4 — Deploy to Railway
1. Push this folder to GitHub (private repo recommended)
2. Go to railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Go to Variables tab and add all 4 environment variables
5. Railway auto-deploys — your bot is live 24/7!

## Commands
| Command | Action |
|---------|--------|
| /mode1 | Safe Filter Swing 🟢 |
| /mode2 | Momentum Riding 🟡 |
| /mode3 | Early Launch Snipe 🟠 |
| /mode4 | Degen First-Minute Snipe 🔴 |
| /pause | Stop new trades |
| /resume | Resume trading |
| /closeall | Dump everything to SOL |
| /portfolio | See open positions |
| /report | Weekly performance |
| /status | Bot status & balance |
| /betsize 5 | Set $5 per trade |

## Security Rules
- NEVER commit .env to GitHub
- NEVER share your WALLET_PRIVATE_KEY
- Only fund your trading wallet with what you can afford to lose
- Keep your main savings in a separate wallet
