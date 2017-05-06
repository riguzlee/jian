const request = require('request-promise');
const cheerio = require('cheerio');
const logger = require('log4js').getLogger();
const fs = require('fs');
const fsExtra = require('fs-extra');
const moment = require('moment');
const path = require('path');
const Promise = require('bluebird');

class Spider {
    constructor($, from) {
        this.$ = $;
        this.from = from;
    }

    static async fetch(url) {
        let options = {
            url: url,
            transform: (body) => {
                return cheerio.load(body, {decodeEntities: false});
            }
        };
        return await request(options);
    }

    static download (uri, filename, callback){
        request.head(uri, (err, res, body) => {
            request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
        });
    }

    static async downloadImage(url, postTime) {
        let arr = url.split('/');
        let fileName = arr[arr.length - 2] + '.jpg';
        let dir = moment(postTime).format('YYYY/MM/DD/');
        let savePath = path.join(__dirname, '../public/postpic', dir + fileName);
        let saveDir = path.join(__dirname, '../public/postpic', dir);
        fsExtra.ensureDirSync(saveDir);
        const downloadPromise = Promise.promisify(this.download);
        await downloadPromise(url, savePath);
        return dir + fileName;
    }
}

class TecentSpider extends Spider {
    constructor($) {
        super($, 't.qq.com');
    }

    extractAll() {
        let $ = this.$;
        let self = this;
        $('#talkList').children('li').each((i, element) => {
            self.extract($(element)).then(post=>{
                console.log(post);
            });
        });
    }

    async extract(li) {
        const self = this;
        let id = li.attr('id');
        logger.debug('fetching post:', id);
        let msgBox = li.find('.msgBox');
        let user = msgBox.find('.userName').attr('rel');
        let content = msgBox.find('.msgCnt').html();
        let mediaWrap = msgBox.find('.multiMedia').find('.mediaWrap');
        let pubInfo = msgBox.find('.pubInfo').find('span');
        let timestamp = pubInfo.find('.time').attr('rel');
        let postTime = new Date(timestamp * 1000);
        let client = pubInfo.find('.f').text();
        let images = this.findImages(mediaWrap);
        let localImages = [];
        for(let i = 0; i < images.length; i++){
            let img = images[i];
            console.log(img.attr('href'));
            let localImage = await self.extractImage(img, postTime);
            localImages.push(localImage);
        }
        let post = {
            content: content,
            when: postTime,
            source: {
                client: client,
                user: user,
                id: id,
                url: 'http://t.qq.com/p/t/' + id,
                from: this.from,
            },
            images: localImages,
        };
        return post;
    }

    async extractImage(a, postTime) {
        let src = a.attr('href');
        let img = a.find('img').attr('crs');
        let localSrc = await Spider.downloadImage(src, postTime);
        let localThumb = await Spider.downloadImage(img, postTime);
        return {
            thumb: localThumb,
            src: localSrc,
        };
    }

    findImages(mediaWrap) {
        if (mediaWrap.length <= 0) return [];
        let pictures = [];
        let $ = this.$;
        let pictureGroup = mediaWrap.find('.tl_imgGroup');
        if (pictureGroup.length > 0) {
            console.log('picture group.');
            pictureGroup.find('.tl_imgGroup_item').each((i, element) => {
                let a = $(element).find('a');
                pictures.push(a);
            });
        }
        else {
            let a = mediaWrap.find('.picBox').find('a');
            pictures.push(a);
            console.log('picture.');
        }
        return pictures;
    }
}


const solee_url = 'http://t.qq.com/solever?gall=1';
Spider.fetch(solee_url).then($ => {
    let spider = new TecentSpider($);
    spider.extractAll();
});