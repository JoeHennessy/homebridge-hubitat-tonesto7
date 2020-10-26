const { platformName, platformDesc, pluginVersion } = require("./libs/Constants"),
    axios = require("axios").default;
// url = require("url");

module.exports = class ST_Client {
    constructor(platform) {
        this.platform = platform;
        this.log = platform.log;
        this.appEvts = platform.appEvts;
        this.use_cloud = platform.use_cloud;
        this.hubIp = platform.local_hub_ip;
        this.configItems = platform.getConfigItems();
        // let appURL = url.parse(this.configItems.app_url);
        this.localErrCnt = 0;
        this.localDisabled = false;
        this.clientsLogSocket = [];
        this.clientsEventSocket = [];
        this.communciationBreakCommand = "off";
        this.registerEvtListeners();
    }

    registerEvtListeners() {
        this.appEvts.on("event:device_command", async(devData, cmd, vals) => {
            await this.sendDeviceCommand(devData, cmd, vals);
        });
        this.appEvts.on("event:plugin_upd_status", async() => {
            await this.sendUpdateStatus();
        });
        this.appEvts.on("event:plugin_start_direct", async() => {
            await this.sendStartDirect();
        });
    }

    sendAsLocalCmd() {
        return this.use_cloud === false && this.hubIp !== undefined;
    }

    // localHubErr(hasErr) {
    //     if (hasErr) {
    //         if (this.use_cloud && !this.localDisabled) {
    //             this.log.error(`Unable to reach your Hubitat Hub Locally... You will not receive device events!!!`);
    //             this.use_cloud = false;
    //             this.localDisabled = true;
    //         }
    //     } else {
    //         if (this.localDisabled) {
    //             this.useLocal = true;
    //             this.localDisabled = false;
    //             this.log.good(`Now able to reach local Hub... Restoring Local Commands!!!`);
    //             this.sendStartDirect();
    //         }
    //     }
    // }

    updateGlobals(hubIp, use_cloud = false) {
        this.log.notice(`Updating Global Values | HubIP: ${hubIp} | UseCloud: ${use_cloud}`);
        this.hubIp = hubIp;
        this.use_cloud = use_cloud === true;
    }

    handleError(src, err, allowLocal = false) {
        switch (err.status) {
            case 401:
                this.log.error(`${src} Error | Hubitat Token Error: ${err.response} | Message: ${err.message}`);
                break;
            case 403:
                this.log.error(`${src} Error | Hubitat Authentication Error: ${err.response} | Message: ${err.message}`);
                break;
            default:
                if (err.message.startsWith("getaddrinfo EAI_AGAIN")) {
                    this.log.error(`${src} Error | Possible Internet/Network/DNS Error | Unable to reach the uri | Message ${err.message}`);
                } else {
                    // console.error(err);
                    this.log.error(`${src} Error: ${err.response} | Message: ${err.message}`);
                }
                break;
        }
    }

    getDevices() {
        let that = this;
        return new Promise((resolve) => {
            console.log(`${that.configItems.use_cloud ? that.configItems.app_url_cloud : that.configItems.app_url_local}${that.configItems.app_id}/devices`);
            axios({
                    method: "get",
                    url: `${that.configItems.use_cloud ? that.configItems.app_url_cloud : that.configItems.app_url_local}${that.configItems.app_id}/devices`,
                    params: {
                        access_token: that.configItems.access_token,
                    },
                    timeout: 10000,
                })
                .then((response) => {
                    resolve(response.data);
                })
                .catch((err) => {
                    this.handleError("getDevices", err);
                    resolve(undefined);
                });
        });
    }

    getDevice(deviceid) {
        let that = this;
        return new Promise((resolve) => {
            axios({
                    method: "get",
                    url: `${that.configItems.use_cloud ? that.configItems.app_url_cloud : that.configItems.app_url_local}${that.configItems.app_id}/${deviceid}/query`,
                    params: {
                        access_token: that.configItems.access_token,
                    },
                    timeout: 10000,
                })
                .then((response) => {
                    resolve(response.data);
                })
                .catch((err) => {
                    this.handleError("getDevice", err);
                    resolve(undefined);
                });
        });
    }

    sendDeviceCommand(devData, cmd, vals) {
        return new Promise((resolve) => {
            let that = this;
            let config = {
                method: "post",
                url: `${this.configItems.use_cloud ? this.configItems.app_url_cloud : this.configItems.app_url_local}${this.configItems.app_id}/${devData.deviceid}/command/${cmd}`,
                params: {
                    access_token: this.configItems.access_token,
                },
                headers: {
                    evtsource: `Homebridge_${platformName}_${this.configItems.app_id}`,
                    evttype: "hkCommand",
                },
                data: vals,
                timeout: 5000,
            };
            try {
                that.log.notice(`Sending Device Command: ${cmd}${vals ? " | Value: " + JSON.stringify(vals) : ""} | Name: (${devData.name}) | DeviceID: (${devData.deviceid}) | SendingViaCloud: (${that.configItems.use_cloud})`);
                axios(config)
                    .then((response) => {
                        // console.log('command response:', response.data);
                        this.log.debug(`sendDeviceCommand | Response: ${JSON.stringify(response.data)}`);
                        // that.localHubErr(false);
                        resolve(true);
                    })
                    .catch((err) => {
                        that.handleError("sendDeviceCommand", err, true);
                        resolve(false);
                    });
            } catch (err) {
                resolve(false);
            }
        });
    }

    sendUpdateStatus() {
        return new Promise((resolve) => {
            this.platform.myUtils.checkVersion().then((res) => {
                this.log.notice(`Sending Plugin Status to SmartThings | UpdateAvailable: ${res.hasUpdate}${res.newVersion ? " | newVersion: " + res.newVersion : ""}`);
                axios({
                        method: "post",
                        url: `${this.configItems.use_cloud ? this.configItems.app_url_cloud : this.configItems.app_url_local}${this.configItems.app_id}/pluginStatus`,
                        params: {
                            access_token: this.configItems.access_token,
                        },
                        data: {
                            hasUpdate: res.hasUpdate,
                            newVersion: res.newVersion,
                            version: pluginVersion,
                        },
                        timeout: 10000,
                    })
                    .then((response) => {
                        // console.log(response.data);
                        if (response.data) {
                            this.log.debug(`sendUpdateStatus Resp: ${JSON.stringify(response.data)}`);
                            resolve(response.data);
                        } else {
                            resolve(null);
                        }
                    })
                    .catch((err) => {
                        this.handleError("sendUpdateStatus", err, true);
                        resolve(undefined);
                    });
            });
        });
    }

    sendStartDirect() {
        let that = this;
        return new Promise((resolve) => {
            let config = {
                method: "post",
                url: `${this.configItems.use_cloud ? this.configItems.app_url_cloud : this.configItems.app_url_local}${this.configItems.app_id}/startDirect/${this.configItems.direct_ip}/${this.configItems.direct_port}/${pluginVersion}`,
                params: {
                    access_token: this.configItems.access_token,
                },
                headers: {
                    evtsource: `Homebridge_${platformName}_${this.configItems.app_id}`,
                    evttype: "enableDirect",
                },
                data: {
                    ip: that.configItems.direct_ip,
                    port: that.configItems.direct_port,
                    version: pluginVersion,
                    evtsource: `Homebridge_${platformName}_${this.configItems.app_id}`,
                    evttype: "enableDirect",
                },
                timeout: 10000,
            };
            that.log.info(`Sending StartDirect Request to ${platformDesc} | SendingViaCloud: (${that.configItems.use_cloud})`);
            try {
                axios(config)
                    .then((response) => {
                        // that.log.info('sendStartDirect Resp:', body);
                        if (response.data) {
                            this.log.debug(`sendStartDirect Resp: ${JSON.stringify(response.data)}`);
                            resolve(response.data);
                            // that.localHubErr(false);
                        } else {
                            resolve(null);
                        }
                    })
                    .catch((err) => {
                        that.handleError("sendStartDirect", err, true);
                        resolve(undefined);
                    });
            } catch (err) {
                resolve(err);
            }
        });
    }
};