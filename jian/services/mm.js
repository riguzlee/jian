const sqlite = require("sqlite3").verbose();
const logger = require('log4js').getLogger();
const Post = require('../models/post');
const request = require('request-promise');
const cheerio = require('cheerio');
const _ = require('lodash');
const xmldoc = require('xmldoc');
const md5 = require('md5');

const Spider = require('./spider').Spider;

const querySql = 'select SnsInfo.*, SnsInfoXml.content as contentXml from SnsInfo ' +
    'left join SnsInfoXml on SnsInfo.stringSeq = SnsInfoXml.stringSeq ' +
    'where SnsInfo.type=? order by createTime desc ' +
    'limit ?';
const limit = 1000; // just for debug purpose
class MmService {
    constructor(dbPath, msgType) {
        this.dbPath = dbPath;
        this.msgType = msgType;
        logger.debug('Config:', dbPath, msgType);
    }


    async extractPosts() {
        logger.debug('Loading data...');
        let db = new sqlite.Database(this.dbPath);
        db.serialize(() => {
            db.each(querySql, this.msgType, limit, (err, row) => {
                if (err) {
                    logger.error(err);
                    return;
                }
                this.parseContent(row)
                    .then(post => {
                        //console.log(post);
                    })
                    .catch(err => {
                        console.error(err);
                    });
            });
        });
        logger.debug('Closing sqlite');
        db.close();
    }

    static mapMimeType(msgType) {
        if (msgType == 1)
            return 'image/jpeg';
        if (msgType == 4)
            return 'audio/mpeg';
        if (msgType == 5)
            return 'video/mpeg';
        if (msgType == 15)
            return 'video/wechat';
        if (msgType == 3)
            return 'text/html';
        return 'unknown';
    }

    async parseContent(row) {
        let doc = new xmldoc.XmlDocument(row.contentXml);
        console.log(doc.toString());
        let mediaList = doc.descendantWithPath("ContentObject.mediaList");
        let contentObject = doc.descendantWithPath('ContentObject');
        let type = doc.valueWithPath("ContentObject.contentStyle");
        let images = [];
        if (mediaList) {
            mediaList.eachChild(media => {
                let image = {
                    src: media.valueWithPath("url"),
                    thumb: media.valueWithPath("thumb"),
                    width: media.valueWithPath("size@width"),
                    height: media.valueWithPath("size@height"),
                    size: media.valueWithPath("size@totalSize"),
                    mimeType: MmService.mapMimeType(type),
                    srcRefer: media.valueWithPath("url"),
                    thumbRefer: media.valueWithPath("thumb"),
                    title: media.valueWithPath("title") || contentObject.valueWithPath('title') || '',
                    description: media.valueWithPath("description") || '',
                };
                if (type == 3)
                    image.src = contentObject.valueWithPath('contentUrl');
                images.push(image);
            });
        }
        let post = {
            content: doc.valueWithPath("contentDesc"),
            when: doc.valueWithPath("createTime"),
            source: {
                client: 'Wechat',
                user: doc.valueWithPath("username"),
                id: doc.valueWithPath("id"),
                url: 'snsId:' + doc.valueWithPath("id"),
                from: 'Wechat',
            },
            msgType: type,
            medias: images,
            video: null,
        };
        console.log(post);
        post = await this.savePost(post);
        return post;
    }

    async savePost(post) {
        let postTime = new Date(post.when * 1000);
        let localMedias = [];
        if (post.medias) {
            for (let i = 0; i < post.medias.length; i++) {
                let img = post.medias[i];
                let localMedia = await this.extractMedia(img, postTime);
                localMedias.push(localMedia);
            }
            post.medias = localMedias;
        }
        let item = new Post(post);
        return item.save();
    }

    async extractMedia(media, postTime) {
        if (media.mimeType === 'image/jpeg') {
            let localSrc = await Spider.downloadImage(media.src, postTime);
            media = _.merge(media, {src: localSrc});
        }
        let thumbName = undefined;
        if (media.mimeType === 'video/wechat') {
            let saveFile = md5(media.src) + '.mp4';
            let localSrc = await Spider.downloadImage(media.src, postTime, saveFile);
            media = _.merge(media, {src: localSrc});
            thumbName = md5(media.thumb) + '.jpg';
        }
        let localThumb = await Spider.downloadImage(media.thumb, postTime, thumbName);
        return _.merge(media, {
            thumb: localThumb,
        });
    }
}

exports = module.exports = MmService;