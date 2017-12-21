'use strict'

const TelegramApi = require('./api/TelegramApi')
const TelegramRouter = require('./routing/TelegramRouter')
const TelegramDataSource = require('./TelegramDataSource')
const UpdateProcessorsManager = require('./updateProcessors/UpdateProcessorsManager')
const InMemoryStorage = require('./storage/session/InMemoryStorage')
const TelegramSessionStorage = require('./storage/session/TelegramSessionStorage')
const TelegramBaseController = require('./mvc/TelegramBaseController')
const TelegramBaseCallbackQueryController = require('./mvc/TelegramBaseCallbackQueryController')
const TelegramBaseInlineQueryController = require('./mvc/TelegramBaseInlineQueryController')
const Models = require('./models/Models')
const Update = require('./models/Update')
const Ivan = require('./localization/Ivan')
const Scope = require('./mvc/Scope')
const InputFile = require('./api/InputFile')
const InlineScope = require('./mvc/InlineScope')
const BaseStorage = require('./storage/BaseStorage')
const BaseLogger = require('./logger/BaseLogger')
const BaseScopeExtension = require('./mvc/BaseScopeExtension')
const BaseUpdateFetcher = require('./updateFetchers/BaseUpdateFetcher')

const SharedStorage = require('./storage/sharedStorage/SharedStorage')

const WebAdmin = require('./webAdmin/server/WebAdmin')

const WebhookUpdateFetcher = require('./updateFetchers/WebhookUpdateFetcher')
const LongPoolingUpdateFetcher = require('./updateFetchers/LongPoolingUpdateFetcher')

const WebAdminLogger = require('./logger/WebAdminLogger')
const Statistics = require('./statistics/Statistics')

const BaseCommand = require('./routing/commands/BaseCommand')
const TextCommand = require('./routing/commands/TextCommand')
const RegexpCommand = require('./routing/commands/RegexpCommand')

class Telegram {
    /**
     *
     * @param {string} token
     * @param {{
     * logger: BaseLogger,
     * storage: BaseStorage,
     * localization: Object[],
     * workers: number,
     * webhook: {url: string, port: number, host: string }
     * updateFetcher: BaseUpdateFetcher
     * webAdmin: {port: number, host: string}
     * }} options
     */
    constructor(token, options) {
        options = options || {}

        this._token = token
        this._logger = options.logger || new WebAdminLogger()
        this._storage = options.storage || new InMemoryStorage()
        this._sharedStorage = new SharedStorage(this._storage)
        this._localization = new Ivan(this._sharedStorage, (options.localization || []))
        this._disableWebAdminHost = options.webAdmin ? options.webAdmin.disable : false

        this._telegramDataSource = new TelegramDataSource(
            new TelegramApi(token, this._logger),
            new TelegramRouter(),
            this._logger,
            new TelegramSessionStorage(this._sharedStorage),
            this._localization
        )

        this._beforeUpdateFunction = null

        this._checkNodeVersion()

        this._updatesFetcher = null

        if (options.updateFetcher)
            this._updatesFetcher = options.updateFetcher
        else if (options.webhook) {
            this._updatesFetcher = new WebhookUpdateFetcher(
                this._telegramDataSource.api,
                this._logger,
                options.webhook.url,
                options.webhook.host,
                options.webhook.port,
                token
            )
        }
        else {
            this._updatesFetcher = new LongPoolingUpdateFetcher(
                this._telegramDataSource.api,
                this._logger
            )
        }

        this._setup()
    }

    _checkNodeVersion() {
        if (process.version.replace('v', '').split('.')[0] < 6) {
            this._logger.error({
                'Fatal error': 'Node version must be 6 or greater, please update your Node.js'
            })

            process.exit()
        }
    }

    _setup() {
        this._updateProcessor = new UpdateProcessorsManager(this._telegramDataSource)

        process.on('message', msg => {
            if (msg.type == 'update') {
                this._processUpdates([Update.deserialize(msg.update)])
                return
            }

            this._sharedStorage.handleMessageFromMaster(msg)
        })

        this._updatesFetcher.fetch(updates => {
            this._processUpdates(updates)
        })
    }

    /**
     * Pass child of BaseScopeExtension or array of children to use that extensions
     *
     * @param {BaseScopeExtension|BaseScopeExtension[]} extension
     */
    addScopeExtension(extension) {
        this._telegramDataSource.addScopeExtension(extension)
    }

    /**
     * @param {Update} update
     */
    emulateUpdate(update) {
        this._updateProcessor.process(update)
    }

    /**
     *
     * @returns {TelegramApi}
     */
    get api() {
        return this._telegramDataSource.api
    }

    /**
     *
     * @returns {TelegramRouter}
     */
    get router() {
        return this._telegramDataSource.router
    }

    /**
     *
     * @returns {BaseLogger}
     */
    get logger() {
        return this._telegramDataSource.logger
    }

    /**
     *
     * @returns {TelegramSessionStorage}
     */
    get sessionStorage() {
        return this._telegramDataSource.sessionStorage
    }

    /**
     * @callback continueCallback
     * @param {boolean} handle
     */

    /**
     * @callback beforeHandler
     * @param {Update} update
     * @param {continueCallback} callback
     */

    /**
     * Your handler function passed to this method will be called after getting
     * any update, but before it's processing.
     *
     * Also to your function will be passed callback function,
     * if you call that function with 'true' argument, then update handling will be continued,
     * else the update will not be handled.
     *
     * @param {beforeHandler} handler
     */
    before(handler) {
        this._beforeUpdateFunction = handler
    }

    /**
     * @param {Update[]} updates
     * @private
     */
    _processUpdates(updates) {
        updates.forEach(update => {
            if (!this._beforeUpdateFunction) {
                this._updateProcessor.process(update)
                return
            }

            this._beforeUpdateFunction(update, handle => {
                if (handle === true) {
                    this._updateProcessor.process(update)
                }
            })
        })
    }

    _pickRandomWorker() {
        const pids = Object.keys(this._workers).filter(pid => this._workers[pid] != null)
        return this._workers[pids[Math.floor(Math.random() * pids.length)]]
    }
}

module.exports = {
    TelegramApi,
    Telegram,
    TelegramBaseController,
    TelegramBaseCallbackQueryController,
    TelegramBaseInlineQueryController,
    Scope,
    BaseLogger,
    BaseScopeExtension,
    InputFile,
    InlineScope,
    BaseStorage,
    BaseUpdateFetcher,
    BaseCommand,
    TextCommand,
    RegexpCommand,
    Models
}
