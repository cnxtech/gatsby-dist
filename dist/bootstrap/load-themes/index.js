"use strict";

const path = require(`path`);

const mergeGatsbyConfig = require(`../../utils/merge-gatsby-config`);

const Promise = require(`bluebird`);

const _ = require(`lodash`);

const debug = require(`debug`)(`gatsby:load-themes`);

const preferDefault = require(`../prefer-default`);

const getConfigFile = require(`../get-config-file`); // get the gatsby-config file for a theme


const resolveTheme = async themeSpec => {
  const themeName = themeSpec.resolve || themeSpec;
  let themeDir;

  try {
    themeDir = path.dirname(require.resolve(themeName));
  } catch (e) {
    // this can be local plugin, and require.resolve will throw
    // in this case - let's return partial entry
    return {
      themeName,
      themeSpec
    };
  }

  const theme = await preferDefault(getConfigFile(themeDir, `gatsby-config`)); // if theme is a function, call it with the themeConfig

  let themeConfig = theme;

  if (_.isFunction(theme)) {
    themeConfig = theme(themeSpec.options || {});
  }

  return {
    themeName,
    themeConfig,
    themeSpec,
    themeDir
  };
}; // single iteration of a recursive function that resolve parent themes
// It's recursive because we support child themes declaring parents and
// have to resolve all the way `up the tree` of parent/children relationships
//
// Theoretically, there could be an infinite loop here but in practice there is
// no use case for a loop so I expect that to only happen if someone is very
// off track and creating their own set of themes


const processTheme = ({
  themeName,
  themeConfig,
  themeSpec,
  themeDir
}, {
  useLegacyThemes
}) => {
  const themesList = useLegacyThemes ? themeConfig && themeConfig.__experimentalThemes : themeConfig && themeConfig.plugins; // gatsby themes don't have to specify a gatsby-config.js (they might only use gatsby-node, etc)
  // in this case they're technically plugins, but we should support it anyway
  // because we can't guarantee which files theme creators create first

  if (themeConfig && themesList) {
    // for every parent theme a theme defines, resolve the parent's
    // gatsby config and return it in order [parentA, parentB, child]
    return Promise.mapSeries(themesList, async spec => {
      const themeObj = await resolveTheme(spec);
      return processTheme(themeObj, {
        useLegacyThemes
      });
    }).then(arr => arr.concat([{
      themeName,
      themeConfig,
      themeSpec,
      themeDir
    }]));
  } else {
    // if a theme doesn't define additional themes, return the original theme
    return [{
      themeName,
      themeConfig,
      themeSpec,
      themeDir
    }];
  }
};

module.exports = async (config, {
  useLegacyThemes = false
}) => {
  const themesA = await Promise.mapSeries(useLegacyThemes ? config.__experimentalThemes || [] : config.plugins || [], async themeSpec => {
    const themeObj = await resolveTheme(themeSpec);
    return processTheme(themeObj, {
      useLegacyThemes
    });
  }).then(arr => _.flattenDeep(arr)); // log out flattened themes list to aid in debugging

  debug(themesA); // map over each theme, adding the theme itself to the plugins
  // list in the config for the theme. This enables the usage of
  // gatsby-node, etc in themes.

  return Promise.mapSeries(themesA, ({
    themeName,
    themeConfig = {},
    themeSpec
  }) => {
    return { ...themeConfig,
      plugins: [...(themeConfig.plugins || []), // theme plugin is last so it's gatsby-node, etc can override it's declared plugins, like a normal site.
      {
        resolve: themeName,
        options: themeSpec.options || {}
      }]
    };
  })
  /**
   * themes resolve to a gatsby-config, so here we merge all of the configs
   * into a single config, making sure to maintain the order in which
   * they were defined so that later configs, like the user's site and
   * children, can override functionality in earlier themes.
   */
  .reduce(mergeGatsbyConfig, {}).then(newConfig => {
    return {
      config: mergeGatsbyConfig(newConfig, config),
      themes: themesA
    };
  });
};
//# sourceMappingURL=index.js.map