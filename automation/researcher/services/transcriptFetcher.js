/**
 * @fileoverview YouTube字幕取得ユーティリティ
 * youtube-transcript パッケージを使って字幕を取得し、テキストとして返します。
 */

const { YoutubeTranscript } = require('youtube-transcript');

/**
 * 指定したVideo IDの字幕を取得して結合します。
 * @param {string} videoId
 * @returns {Promise<string|null>} 字幕テキスト（取得できない場合はnull）
 */
const fetchTranscriptText = async (videoId) => {
  if (!videoId) return null;
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!Array.isArray(transcript) || transcript.length === 0) return null;
    return transcript.map((item) => item.text).join(' ').trim();
  } catch (error) {
    // 字幕が無効/未公開の場合などに備え、呼び出し元で扱いやすいようnullを返す
    console.warn(`[transcript] ${videoId}: ${error.message}`);
    return null;
  }
};

module.exports = {
  fetchTranscriptText,
};
