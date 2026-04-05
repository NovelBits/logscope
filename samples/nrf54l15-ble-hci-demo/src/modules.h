/*
 * LogScope Demo — shared declarations for simulated modules
 */

#ifndef LOGSCOPE_DEMO_MODULES_H
#define LOGSCOPE_DEMO_MODULES_H

#include <stdint.h>
#include <stdbool.h>

/* Sensor driver */
void sensor_drv_init(void);
void sensor_drv_read(int cycle);
uint32_t sensor_drv_get_value(void);
void sensor_drv_anomaly(bool connected);

/* Flash manager */
void flash_mgr_init(void);
void flash_mgr_tick(int cycle);
void flash_mgr_corruption(void);

/* Crypto manager */
void crypto_mgr_init(void);
void crypto_mgr_tick(int cycle);

/* Bluetooth LE manager */
void ble_mgr_init(void);
void ble_mgr_tick(int cycle);
void ble_mgr_on_connected(void);
void ble_mgr_on_disconnected(void);
void ble_mgr_send_notification(uint32_t value);
void ble_mgr_toggle_advertising(void);
void ble_mgr_force_disconnect(void);
struct bt_conn *ble_mgr_get_conn(void);
void ble_mgr_set_conn(struct bt_conn *conn);

/* Burst mode */
void burst_run(int *remaining);

#endif
