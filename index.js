// noinspection JSCheckFunctionSignatures,JSUnresolvedReference

const core = require('@actions/core');
const github = require('@actions/github');
const http = require('@actions/http-client');
const cheerio = require('cheerio');
const client = new http.HttpClient('firefox', null, {
    allowRedirects: false,
});

try {
    const githubToken = core.getInput("github-token");

    console.log(`Action Token: ${githubToken}`);

    syncMikanIds(githubToken)
        .then(() => {
            console.log("全部操作完成！");
        });
} catch (error) {
    core.setFailed(error.message);
}


async function syncMikanIds(githubToken) {
    const homeIds = await client
        .get("https://mikanani.me")
        .then(res => res.readBody())
        .then((string) => {
            const $ = cheerio.load(string);
            const items = [];

            $(".m-week-square a").each((index, item) => {
                // noinspection JSCheckFunctionSignatures
                const url = $(item).attr("href") || "";
                console.log(url)
                const lastIndex = url.lastIndexOf("/");
                const id = lastIndex === -1 ? 0 : Number.parseInt(url.substring(lastIndex + 1));
                if (id !== 0) items.push(id);
            });
            return items;
        });

    // 查询已经存在的数据
    const data = await queryTargetContent(githubToken);
    let oldMapIds;
    try {
        const buffer = Buffer.from(data.content || '', 'base64');
        oldMapIds = JSON.parse(buffer.toString());
    } catch (e) {
        oldMapIds = {};
    }

    console.log("已经存在的数据: " + Object.keys(oldMapIds).length);

    const maxId = Math.max(...homeIds);
    const mapIds = {};
    for (let i = 1; i <= maxId; i++) {
        const bgmId = oldMapIds[i.toString()] || '';
        if (bgmId.length > 0) {
            mapIds[i.toString()] = bgmId;
            console.log(`MikanId: ${i} -> BgmId: ${bgmId}, 来自缓存数据`);
        } else {
            const id = await requestBgmId(i);
            if (id.length > 0) {
                mapIds[i.toString()] = id;
            }

            console.log(`MikanId: ${i} -> BgmId: ${id}`);
        }
    }

    console.log("映射表同步完成");

    const string = JSON.stringify(mapIds, null, 4);
    await uploadJson(githubToken, string);

    console.log("上传完成");
}


const requestBgmId = async (id) => {
    const url = `https://mikanani.me/Home/Bangumi/${id}`;
    return await client
        .get(url)
        .then(res => {
            if (res.message.statusCode < 200 || res.message.statusCode > 299) {
                throw Error(`Http Code: ${res.message.statusCode}, ${url}`)
            }
            return res.readBody();
        })
        .then((string) => {
            const $ = cheerio.load(string);
            let bgmId = "";
            $("a.w-other-c").each((index, item) => {
                const url = $(item).text() || "";
                const subIndex = url.indexOf("bgm.tv/subject");
                if (subIndex !== -1) {
                    const lastSubIndex = url.lastIndexOf("/")
                    bgmId = lastSubIndex === -1 ? '' : url.substring(lastSubIndex + 1);
                }
            });
            return bgmId;
        })
        .catch(() => "");
}

async function uploadJson(githubToken, string) {
    const data = await queryTargetContent(githubToken);
    const sha = data.sha || '';
    const params = repoInfo();

    const octokit = github.getOctokit(githubToken);
    octokit.rest.repos.createOrUpdateFileContents({
        owner: params.owner,
        repo: params.repo,
        path: params.path,
        message: '同步更新蜜柑映射表',
        content: Buffer.from(string).toString('base64'),
        committer: {
            name: 'GitHub Actions',
            email: 'actions@github.com',
        },
        author: {
            name: 'GitHub Actions',
            email: 'actions@github.com',
        },
        sha: sha,
    }).then(() => {
        console.log(`上传成功`);
        core.setOutput("message", `https://github.com/${owner}/${repo}/raw/main/${fileName}`);
    }).catch(error => {
        console.error(`Error uploading file "${fileName}":`, error);
        core.setOutput("message", `Error uploading file "${fileName}":` + error);
        core.setFailed(error.message);
    });
}

const queryTargetContent = async (githubToken) => {
    if (githubToken.length === 0) return {};

    const params = repoInfo();

    console.log(`owner:${params.owner}, repo: ${params.repo}`);

    const octokit = github.getOctokit(githubToken);
    const res = await octokit.rest.repos
        .getContent(params)
        .catch(() => ({data: {}}));

    return res.data || {};
}

const repoInfo = () => {
    const {owner, repo} = github.context.repo;
    const path = core.getInput("mikan-json-path") || "mikan/bangumi-mikan.json";
    return {owner: owner, repo: repo, path: path}
}

