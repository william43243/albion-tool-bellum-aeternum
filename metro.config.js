const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude @mlc-ai/web-llm from Android bundles — it requires Node.js 'url'
// module which doesn't exist in React Native. WebLLM is only used on web.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'android' && moduleName === '@mlc-ai/web-llm') {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
