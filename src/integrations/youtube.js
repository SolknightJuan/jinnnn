const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getAllYoutubeChannels, updateLastVideoId } = require('../database/database');
const { youtube: logger } = require('../utils/logger');

class YouTubeIntegration {
    constructor() {
        logger.info('Initializing YouTube integration');
        this.api = axios.create({
            baseURL: 'https://www.googleapis.com/youtube/v3',
            params: {
                key: process.env.YOUTUBE_API_KEY
            }
        });
        logger.debug('YouTube API client created');
    }

    createVideoEmbed(video, channel) {
        logger.debug('Creating video embed', { 
            videoId: video.id,
            channelId: channel.id,
            channelTitle: channel.snippet.title
        });

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle(video.snippet.title)
            .setURL(`https://www.youtube.com/watch?v=${video.id}`)
            .setAuthor({
                name: channel.snippet.title,
                iconURL: channel.snippet.thumbnails.default.url,
                url: `https://www.youtube.com/channel/${channel.id}`
            })
            .setDescription(video.snippet.description?.slice(0, 200) + '...')
            .setImage(video.snippet.thumbnails.high.url)
            .setTimestamp(new Date(video.snippet.publishedAt))
            .setFooter({ text: 'YouTube' });

        return embed;
    }

    async fetchLatestVideos(channelId) {
        try {
            logger.info(`Fetching channel details for: ${channelId}`);
            // First, get the channel details
            const channelResponse = await this.api.get('/channels', {
                params: {
                    part: 'contentDetails,snippet',
                    id: channelId
                }
            });

            if (!channelResponse.data.items?.length) {
                logger.warn(`Channel not found: ${channelId}`);
                throw new Error('Channel not found');
            }

            const channel = channelResponse.data.items[0];
            const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;
            logger.debug(`Found uploads playlist: ${uploadsPlaylistId}`, {
                channelTitle: channel.snippet.title
            });

            // Then, get the latest videos from the uploads playlist
            logger.info(`Fetching latest videos from playlist: ${uploadsPlaylistId}`);
            const videosResponse = await this.api.get('/playlistItems', {
                params: {
                    part: 'snippet',
                    playlistId: uploadsPlaylistId,
                    maxResults: 5,
                    order: 'date'
                }
            });

            if (!videosResponse.data.items?.length) {
                logger.debug(`No videos found in playlist: ${uploadsPlaylistId}`);
                return null;
            }

            // Get detailed video information
            const videoIds = videosResponse.data.items.map(item => item.snippet.resourceId.videoId);
            logger.debug(`Fetching detailed information for ${videoIds.length} videos`);
            
            const videoDetailsResponse = await this.api.get('/videos', {
                params: {
                    part: 'snippet,statistics',
                    id: videoIds.join(',')
                }
            });

            logger.info(`Successfully fetched ${videoDetailsResponse.data.items.length} videos for channel: ${channel.snippet.title}`);
            return {
                channel,
                videos: videoDetailsResponse.data.items
            };

        } catch (error) {
            logger.error(`Error fetching videos for channel ${channelId}:`, {
                error: error.message,
                response: error.response?.data,
                stack: error.stack
            });
            return null;
        }
    }

    async checkNewUploads() {
        logger.info('Starting new uploads check');
        const channels = await getAllYoutubeChannels();
        const results = [];

        for (const channel of channels) {
            try {
                const data = await this.fetchLatestVideos(channel.channel_id);
                if (!data) {
                    logger.debug(`No data returned for channel: ${channel.channel_id}`);
                    continue;
                }

                const { channel: channelInfo, videos } = data;
                
                // Filter only new videos
                const newVideos = videos.filter(video => {
                    const videoDate = new Date(video.snippet.publishedAt);
                    // Check if video is newer than last check (within last 15 minutes)
                    return videoDate > new Date(Date.now() - 15 * 60 * 1000);
                });

                if (newVideos.length > 0) {
                    logger.info(`Found ${newVideos.length} new videos for channel: ${channelInfo.snippet.title}`);
                    // Update last video ID
                    await updateLastVideoId(channel.channel_id, newVideos[0].id);
                    
                    results.push({
                        channel: channelInfo,
                        videos: newVideos
                    });
                } else {
                    logger.debug(`No new videos found for channel: ${channelInfo.snippet.title}`);
                }
            } catch (error) {
                logger.error(`Error checking uploads for ${channel.channel_id}:`, {
                    error: error.message,
                    stack: error.stack
                });
            }
        }

        logger.info(`Upload check completed. Found new videos in ${results.length} channels`);
        return results;
    }
}

module.exports = new YouTubeIntegration();
