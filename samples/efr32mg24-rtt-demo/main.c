/* Minimal RTT test for EFR32MG24 (Cortex-M33) */
#include "SEGGER_RTT.h"

/* Busy-wait delay */
static void delay(volatile int count) {
    while (count-- > 0) {}
}

int main(void) {
    SEGGER_RTT_Init();

    int counter = 0;
    while (1) {
        SEGGER_RTT_printf(0, "[00:00:%02d.000,000] <inf> app: Heartbeat %d from EFR32MG24\n",
                          counter % 60, counter);
        counter++;

        if (counter % 5 == 0) {
            SEGGER_RTT_printf(0, "[00:00:%02d.000,000] <wrn> sensor_drv: Temperature reading high: 45.2C\n",
                              counter % 60);
        }
        if (counter % 10 == 0) {
            SEGGER_RTT_printf(0, "[00:00:%02d.000,000] <err> flash_mgr: Write failed at 0x%08x\n",
                              counter % 60, 0x00080000 + counter * 256);
        }

        delay(2000000);  /* ~1 second at 39MHz */
    }
}

/* Minimal vector table for Cortex-M33 */
extern unsigned int _estack;
void Reset_Handler(void);
void Default_Handler(void) { while(1); }

void NMI_Handler(void) __attribute__((weak, alias("Default_Handler")));
void HardFault_Handler(void) __attribute__((weak, alias("Default_Handler")));

__attribute__((section(".isr_vector")))
void (*const vector_table[])(void) = {
    (void (*)(void))&_estack,
    Reset_Handler,
    NMI_Handler,
    HardFault_Handler,
};

void Reset_Handler(void) {
    /* Zero BSS */
    extern unsigned int __bss_start__, __bss_end__;
    for (unsigned int *p = &__bss_start__; p < &__bss_end__; p++)
        *p = 0;
    /* Copy data */
    extern unsigned int _sidata, _sdata, _edata;
    unsigned int *src = &_sidata, *dst = &_sdata;
    while (dst < &_edata) *dst++ = *src++;

    main();
    while(1);
}
