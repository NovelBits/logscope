cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(logscope-uart-demo)
target_sources(app PRIVATE
  src/main.c
  src/sensor_drv.c
  src/flash_mgr.c
  src/crypto_mgr.c
)
