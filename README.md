# Discord Social Media Bot

A powerful, lightweight Discord bot that provides real-time notifications for Twitter posts and YouTube uploads. Built with Discord.js and supports sharding for scalability.

## Features

- **Twitter Integration**
  - Real-time tweet notifications
  - Automatic conversion to vxtwitter.com links
  - Original tweet link button
  - Dynamic account management
  - Rate limit handling

- **YouTube Integration**
  - Real-time upload notifications
  - Channel status monitoring
  - Efficient polling system
  - Dynamic channel management

- **Discord Features**
  - Separate channels for Twitter and YouTube notifications
  - Slash commands for easy management
  - Permission-based command access
  - Server-specific configurations

- **Advanced Logging System**
  - Component-specific log files
  - Rotating log files with retention
  - Multiple log levels (error, warn, info, debug)
  - Structured JSON logging
  - Detailed error tracking

## Prerequisites

- Node.js 16.9.0 or higher
- Discord Bot Token
- Twitter API Bearer Token
- YouTube Data API v3 Key

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on `.env.example`:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_client_id
   TWITTER_BEARER_TOKEN=your_twitter_bearer_token
   YOUTUBE_API_KEY=your_youtube_api_key
   DATABASE_PATH=./data/database.sqlite
   LOG_LEVEL=info
   ```

## Commands

### Setup
- `/setup twitter:#channel youtube:#channel` - Configure notification channels

### Twitter Management
- `/twitter add username` - Add a Twitter account to monitor
- `/twitter remove username` - Remove a Twitter account
- `/twitter list` - List all monitored accounts

### YouTube Management
- `/youtube add channel_id` - Add a YouTube channel to monitor
- `/youtube remove channel_id` - Remove a YouTube channel
- `/youtube list` - List all monitored channels

## Running the Bot

Development mode with auto-restart:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Logging System

The bot includes a comprehensive logging system that helps track operations and troubleshoot issues:

### Log Levels
- **error**: Critical issues that need immediate attention
- **warn**: Important events that aren't critical but may need attention
- **info**: General operational information
- **debug**: Detailed information for debugging purposes

### Log Files
Logs are stored in the `logs` directory:
- `combined-%DATE%.log`: All log entries
- `error-%DATE%.log`: Error-level entries only
- Component-specific logs:
  - `database-%DATE%.log`: Database operations
  - `twitter-%DATE%.log`: Twitter integration
  - `youtube-%DATE%.log`: YouTube integration
  - `commands-%DATE%.log`: Command execution
  - `system-%DATE%.log`: General system events

### Log Rotation
- Logs are automatically rotated daily
- Maximum file size: 20MB
- Retention period: 14 days

## Troubleshooting

### Common Issues

1. **Command Registration Failed**
   - Check the `commands.log` file for deployment errors
   - Verify Discord bot token and permissions
   - Ensure bot has application.commands scope

2. **Twitter Updates Not Working**
   - Check `twitter.log` for rate limit information
   - Verify Twitter Bearer Token
   - Ensure accounts are properly added using `/twitter add`

3. **YouTube Updates Delayed**
   - Check `youtube.log` for API quota usage
   - Verify YouTube API key
   - Review polling intervals in logs

4. **Database Errors**
   - Check `database.log` for specific errors
   - Verify write permissions for database directory
   - Check disk space availability

### Debugging

To enable detailed debug logging:
1. Set `LOG_LEVEL=debug` in your `.env` file
2. Restart the bot
3. Check component-specific log files for detailed information

## Technical Details

- Uses SQLite for lightweight data storage
- Implements efficient polling with rate limit consideration
- Automatic command registration
- Error handling and logging
- Sharding support for large-scale deployments

## Getting API Keys

### Discord
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Add a bot to your application
4. Get the bot token and client ID

### Twitter
1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Create a project and get your Bearer Token

### YouTube
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable YouTube Data API v3
3. Create credentials to get your API key

## Contributing

Feel free to submit issues and enhancement requests!
