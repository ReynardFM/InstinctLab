// The eye loop (same sums, same order as senses.ts eyeInto, K = 4, no walls) on made-up data: how fast can native code do it?
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#define C 62
#define F 234
#define HN 12
#define T 15000
static uint32_t seed = 12345;
static double rnd(void) { seed = seed * 1664525u + 1013904223u; return (double)(seed >> 8) / 16777216.0; }
int main(void) {
  static double fx[F], fy[F], cx[C], cy[C], ch[C], sh[C], hx[HN], hy[HN], hs[HN]; static uint8_t st[F];
  for (int i = 0; i < F; i++) { fx[i] = rnd() * 800; fy[i] = rnd() * 600; double u = rnd(); st[i] = u < 0.2 ? 0 : u < 0.44 ? 2 : 1; }
  for (int i = 0; i < C; i++) { cx[i] = rnd() * 800; cy[i] = rnd() * 600; ch[i] = rnd() * 2 - 1; sh[i] = rnd() * 2 - 1; }
  for (int i = 0; i < HN; i++) { hx[i] = rnd() * 800; hy[i] = rnd() * 600; hs[i] = rnd() * 2; }
  const double W = 800, H = 600, halfW = 400, halfH = 300, R = 200, R2 = 40000;
  double in[20], sum = 0; long checks = 0;
  struct timespec a, b; clock_gettime(CLOCK_MONOTONIC, &a);
  for (int t = 0; t < T; t++) {
    for (int c = 0; c < C; c++) {
      const double x = cx[c], y = cy[c], cosH = ch[c], sinH = sh[c];
      for (int k = 0; k < 20; k++) in[k] = 0;
      // two passes: first the distances for every plant (no branches, the compiler can use wide registers), then the sums in order
      static double DX[F], DY[F], D2[F];
      for (int i = 0; i < F; i++) {
        double dx = fx[i] - x; dx = dx > halfW ? dx - W : dx < -halfW ? dx + W : dx;
        double dy = fy[i] - y; dy = dy > halfH ? dy - H : dy < -halfH ? dy + H : dy;
        DX[i] = dx; DY[i] = dy; D2[i] = dx * dx + dy * dy;
      }
      for (int i = 0; i < F; i++) {
        const int s = st[i]; checks++;
        const double d2 = D2[i];
        if (s == 0 || d2 >= R2) continue;
        const double dx = DX[i], dy = DY[i];
        const double v = 1 - d2 / R2, aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
        const int q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
        in[q] += v; if (s == 2) in[4 + q] += v;
      }
      for (int i = 0; i < C; i++) {
        checks++;
        if (i == c) continue;
        double dx = cx[i] - x; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        if (dx >= R || dx <= -R) continue;
        double dy = cy[i] - y; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
        const double d2 = dx * dx + dy * dy; if (d2 >= R2) continue;
        const double aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
        const int q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
        in[8 + q] += 1 - d2 / R2;
      }
      for (int i = 0; i < HN; i++) {
        checks++;
        double dx = hx[i] - x; if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        double dy = hy[i] - y; if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
        const double d2 = dx * dx + dy * dy; if (d2 >= R2) continue;
        const double v = 1 - d2 / R2, aa = dx * cosH + dy * sinH, ss = dy * cosH - dx * sinH, ar = aa + ss, sr = ss - aa;
        const int q = ar >= 0 ? (sr >= 0 ? 0 : 3) : (sr >= 0 ? 1 : 2);
        const double m = hs[i] / 2 < 1 ? hs[i] / 2 : 1;
        in[12 + q] += v; in[16 + q] += v * m;
      }
      for (int k = 0; k < 20; k++) sum += in[k];
      cx[c] = x + 1 >= W ? x + 1 - W : x + 1; // the creature drifts, so every tick differs
    }
  }
  clock_gettime(CLOCK_MONOTONIC, &b);
  double sec = (b.tv_sec - a.tv_sec) + (b.tv_nsec - a.tv_nsec) / 1e9; uint64_t bits; memcpy(&bits, &sum, 8);
  printf("C two-pass: %.2f s, %.2f ns per check, checks %ld, checksum %016llx\n", sec, 1e9 * sec / checks, checks, (unsigned long long)bits);
  return 0;
}
