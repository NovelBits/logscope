#!/bin/bash
# Source this before building: source setup-env.sh

NCS_VERSION=v3.2.0
NCS_BASE=/opt/nordic/ncs
TOOLCHAIN_ID=322ac893fe

export ZEPHYR_BASE="${NCS_BASE}/${NCS_VERSION}/zephyr"
export ZEPHYR_TOOLCHAIN_VARIANT=zephyr
export ZEPHYR_SDK_INSTALL_DIR="${NCS_BASE}/toolchains/${TOOLCHAIN_ID}/opt/zephyr-sdk"
export PATH="${NCS_BASE}/toolchains/${TOOLCHAIN_ID}/bin:${NCS_BASE}/toolchains/${TOOLCHAIN_ID}/opt/bin:${NCS_BASE}/toolchains/${TOOLCHAIN_ID}/opt/zephyr-sdk/arm-zephyr-eabi/bin:${NCS_BASE}/toolchains/${TOOLCHAIN_ID}/opt/zephyr-sdk/riscv64-zephyr-elf/bin:${PATH}"

echo "NCS ${NCS_VERSION} environment ready (ZEPHYR_BASE=${ZEPHYR_BASE})"
