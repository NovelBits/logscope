/* Minimal linker script for EFR32MG24B210F1536IM48 */
/* Flash: 1536KB at 0x08000000, SRAM: 256KB at 0x20000000 */

MEMORY
{
    FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 1536K
    RAM (rwx)   : ORIGIN = 0x20000000, LENGTH = 256K
}

_estack = ORIGIN(RAM) + LENGTH(RAM);

SECTIONS
{
    .text :
    {
        KEEP(*(.isr_vector))
        *(.text*)
        *(.rodata*)
        . = ALIGN(4);
    } > FLASH

    _sidata = LOADADDR(.data);

    .data :
    {
        _sdata = .;
        *(.data*)
        . = ALIGN(4);
        _edata = .;
    } > RAM AT > FLASH

    .bss :
    {
        __bss_start__ = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        __bss_end__ = .;
    } > RAM
}
