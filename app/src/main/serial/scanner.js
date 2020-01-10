'use strict';

const _ = require('lodash');
const rendererConsole = require('../utils/rendererConsole');
const SerialPort = require('@serialport/stream');
const electPort = require('./electPortFunction');
const { CLOUD_MODE_TYPES: CloudModeTypes } = require('../../common/constants');

/**
 * 전체 포트를 검색한다.
 * 검색 조건은 hwModule 의 config 에서 설정한다.
 * pnpId, VendorName, select port 등등 이다.
 *
 * 결과의 송수신은 router 에 만들어진 함수로 보낸다.
 */
class Scanner {
    static get SCAN_INTERVAL_MILLS() {
        return 1500;
    }

    constructor(router) {
        this.router = router;
        this.isScanning = false;
    }

    async startScan(hwModule, config) {
        this.stopScan();
        this.setConfig(config);
        this.hwModule = hwModule;
        return await this.intervalScan();
    };

    setConfig(config) {
        this.config = config;
    }

    async intervalScan() {
        this.isScanning = true;
        let scanResult = undefined;
        while (this.isScanning) {
            scanResult = await this.scan();
            if (scanResult) {
                this.isScanning = false;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, Scanner.SCAN_INTERVAL_MILLS));
        }
        return scanResult;
    }

    async scan() {
        if (!this.config) {
            console.warn('config is not present');
            return;
        }

        const serverMode = this.router.currentCloudMode;
        const { hardware, this_com_port: selectedComPortName } = this.config;
        let { select_com_port: needCOMPortSelect } = this.config;
        const {
            comName: verifiedComPortNames,
            pnpId,
            type,
        } = hardware;
        let { vendor } = hardware;

        // win, mac 플랫폼에 맞는 벤더명 설정
        if (vendor && _.isPlainObject(vendor)) {
            vendor = vendor[process.platform];
        }

        // win, mac 플랫폼에 맞춰 COMPort 확인창 필요한지 설정
        if (needCOMPortSelect && _.isPlainObject(needCOMPortSelect)) {
            needCOMPortSelect = needCOMPortSelect[process.platform];
        }

        // comPort 선택지가 필요한지 체크한다. 블루투스나 클라우드 모드인경우 무조건 검사한다.
        const isComPortSelected =
            needCOMPortSelect ||
            type === 'bluetooth' ||
            serverMode === CloudModeTypes.cloud;

        // 전체 포트 가져오기
        const comPorts = await SerialPort.list();
        rendererConsole.log(JSON.stringify(comPorts));

        const selectedPorts = [];

        // 포트 선택을 유저에게서 직접 받아야 하는가?
        if (isComPortSelected) {
            // 포트가 외부에서 선택되었는가?
            if (selectedComPortName) {
                // lost 후 reconnect 임시 대응
                if (comPorts
                    .map((portData) => portData.path)
                    .findIndex((path) => path === selectedComPortName) === -1) {
                    return;
                }
                selectedPorts.push(selectedComPortName);
            } else {
                this.router.sendState('select_port', comPorts);
                return;
            }
        } else {
            // 포트 선택을 config 에서 처리해야 하는 경우
            comPorts.forEach((port) => {
                const comName = port.path || hardware.name;

                // config 에 입력한 특정 벤더와 겹치는지 여부
                const isVendor = this._indexOfStringOrArray(vendor, port.manufacturer);

                // config 에 입력한 특정 COMPortName과 겹치는지 여부
                const isComName = this._indexOfStringOrArray(verifiedComPortNames, comName);

                // config 에 입력한 특정 pnpId와 겹치는지 여부
                const isPnpId = this._indexOfStringOrArray(pnpId, port.pnpId);

                // 현재 포트가 config 과 일치하는 경우 연결시도할 포트목록에 추가
                if (isVendor || isPnpId || isComName) {
                    selectedPorts.push(comName);
                }
            });
        }

        const electedConnector = await electPort(selectedPorts, hardware, this.hwModule,
            ({ connector }) => {
                if (this.config.firmware) {
                    /*
                    펌웨어가 없는 상태에서 통신이 이루어지지 않는 경우,
                    before_connect 로 임시 연결됨 상태로 만들어서 펌웨어 버튼은 동작할 수 있게끔
                    만든다.
                    TODO 현재는 여러개의 포트가 선출되는 경우, 가장 첫번째 포트를 선택한다.
                     */
                    this.router.connector = connector;
                    this.router.sendState('before_connect');
                }
            },
        );

        if (electedConnector) {
            rendererConsole.log(`${electedConnector.port} is finally connected`);
            this.stopScan();
            return electedConnector.connector;
        }
    };

    /**
     * arrayOrString 내에 target 이 포함되어있는지 검사한다.
     * @param {?String|?Array<String>} arrayOrString
     * @param {?String} target
     * @returns {boolean}
     */
    _indexOfStringOrArray(arrayOrString, target) {
        if (!target || !arrayOrString) {
            return false;
        }

        if (Array.isArray(arrayOrString)) {
            // arrayOrString.some((item)=>target.includes(item))
            // noinspection JSUnresolvedFunction
            return arrayOrString.some((item) => target.indexOf(item) >= 0);
        } else {
            // noinspection JSValidateTypes
            return target.indexOf(arrayOrString) >= 0;
        }
    }

    stopScan() {
        this.config = undefined;
        this.isScanning = false;
    };
}

module.exports = Scanner;
