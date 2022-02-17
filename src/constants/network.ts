export enum NetworkStatusType {
    STAT_UNKNOWN= 0,
    STAT_BEACON_TIMEOUT = 200,
    STAT_NO_AP_FOUND = 201,
    STAT_WRONG_PASSWORD = 202,
    STAT_ASSOC_FAIL = 203,
    STAT_HANDSHAKE_TIMEOUT = 204,
    STAT_IDLE = 1000,
    STAT_CONNECTING = 1001,
    STAT_GOT_IP = 1010,
}

export enum NetworkStatusParam {
    RSSI = 'rssi'
}