const got = require('@/utils/got');
const logger = require('@/utils/logger');
const semver = require('semver');

// 1. fetch the meta
// 2. parse latest packages from meta
// 3. loop fetch every package:
//     1. query package local update time (LUT)
//     2. loop every version after LUT, insert version record.
//     3. update package LUT
// 4. query all packages unions cache sort by version time.
const cache = {
    packageUpdateTimes: {},
    lastResponseVersions: [],
};

async function gotPackage(packageId) {
    return got({
        method: 'get',
        url: `https://packages.unity.com/${packageId}`,
    });
}

async function getPackageList() {
    const meta = (await gotPackage('com.unity.package-manager.metadata')).data;
    const version = meta['dist-tags'].latest;
    return meta.versions[version].searchablePackages;
}

async function fetchNewPackageVersions(packageId) {
    const pack = (await gotPackage(packageId)).data;

    // process new versions only
    const localUpdateTime = cache.packageUpdateTimes[packageId] || new Date(0);
    const versions = Object.values(pack.versions);
    if (versions.length === 0) {
        logger.warn(`upm: empty version for package: ${packageId}`);
        return [];
    }

    // add field time
    const versionTimes = pack.time;
    versions.forEach((item) => {
        item.time = new Date(versionTimes[item.version]);
    });

    const result = versions.filter((item) => item.time >= localUpdateTime);
    cache.packageUpdateTimes[packageId] = result.map((item) => item.time).reduce((a, b) => (a > b ? a : b));
    return result;
}

function flat(array) {
    return array.reduce((a, b) => a.concat(b), []);
}

module.exports = async (ctx) => {
    const packages = await getPackageList();
    const tasks = [];
    const limit = 10;
    for (const packageId of packages) {
        tasks.push(fetchNewPackageVersions(packageId));
    }
    const versionsRaw = flat(await Promise.all(tasks));
    const versions = versionsRaw
        .concat(cache.lastResponseVersions)
        .sort((a, b) => (a.time > b.time ? -1 : 1))
        .slice(0, limit);
    cache.lastResponseVersions = versions;

    ctx.state.data = {
        title: 'Unity UPM Package Updates',
        link: 'https://docs.unity3d.com/Manual/pack-alpha.html',
        description: 'Unity UPM Package Updates',
        item: versions.map((item) => ({
            title: `${item.displayName} - ${item.version}`,
            description: `${item.description}`,
            pubDate: item.time.toUTCString(),
            link: `https://docs.unity3d.com/Packages/${item.name}@${semver.major(item.version)}.${semver.minor(item.version)}/changelog/CHANGELOG.html`,
        })),
    };
};
