import { describe, it, expect } from 'vitest';
import { parseReport } from '../hidSource';

describe('parseReport', () => {
  it('should parse roll +660 (bytes 3-4 LE) to axes[0]=1.0', () => {
    const buf = new Uint8Array(13).fill(0);
    buf[3] = 0x94; // 0x0294 LE = 660
    buf[4] = 0x02;

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([1.0, 0, 0, 0, 0]);
    expect(buttons).toEqual(Array(24).fill(false));
  });

  it('should parse roll -660 (bytes 3-4 LE) to axes[0]=-1.0', () => {
    const buf = new Uint8Array(13).fill(0);
    buf[3] = 0x6c; // 0xFD6C LE = -660
    buf[4] = 0xfd;

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([-1.0, 0, 0, 0, 0]);
    expect(buttons).toEqual(Array(24).fill(false));
  });

  it('should parse pitch +660 (bytes 5-6 LE) to axes[1]=1.0', () => {
    const buf = new Uint8Array(13).fill(0);
    buf[5] = 0x94; // 0x0294 LE = 660
    buf[6] = 0x02;

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([0, 1.0, 0, 0, 0]);
    expect(buttons).toEqual(Array(24).fill(false));
  });

  it('should clamp raw value 700 to 1.0', () => {
    const buf = new Uint8Array(13).fill(0);
    // 700 = 0x02BC, little-endian: low byte 0xBC, high byte 0x02
    buf[3] = 0xbc;
    buf[4] = 0x02;

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([1.0, 0, 0, 0, 0]);
    expect(buttons).toEqual(Array(24).fill(false));
  });

  it('should parse button byte 0x10 -> buttons[4]=true', () => {
    const buf = new Uint8Array(13).fill(0);
    buf[0] = 0x10; // binary 00010000 -> bit 4 set

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([0, 0, 0, 0, 0]);

    const expectedButtons = Array(24).fill(false);
    expectedButtons[4] = true;
    expect(buttons).toEqual(expectedButtons);
  });

  it('should parse button byte 0x12 -> buttons[1] and buttons[4] true', () => {
    const buf = new Uint8Array(13).fill(0);
    buf[0] = 0x12; // binary 00010010 -> bits 1 and 4 set

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([0, 0, 0, 0, 0]);

    const expectedButtons = Array(24).fill(false);
    expectedButtons[1] = true;
    expectedButtons[4] = true;
    expect(buttons).toEqual(expectedButtons);
  });

  it('should return all zeros for an empty report', () => {
    const buf = new Uint8Array(13).fill(0);

    const { axes, buttons } = parseReport(buf);
    expect(axes).toEqual([0, 0, 0, 0, 0]);
    expect(buttons).toEqual(Array(24).fill(false));
  });
});
