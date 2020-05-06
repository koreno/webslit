import sys
import string
from pyfiglet import Figlet
from math import exp
from random import randrange, random, shuffle, choice
import ansi
from keyboard import keyboard_listener
from easypy.timing import Timer
from easypy.misc import at_most
from base64 import b64decode
from os import get_terminal_size
import time

ALIVE = "▓████▓█"
DECAY = "╾╼┉┅┈┄╍┉┅╌┈┄╍╌" * 2

OPTS = [b'Q3JhdGVy', b'R2FtZSBvZiBMaWZl']
OPTS = [b64decode(opt).decode() for opt in OPTS]


def random_exp(s0, s1, M=1.75, random=random):
    # exponential distribution - https://www.desmos.com/calculator/hxhr9w4hou
    # the higher M is, the more we'll bias towards s0
    r = random()
    b = (r ** exp(M)) if M > 0 else (1 - (1 - r) ** exp(M))
    return b * (s1 - s0) + s0


class wraplist(list):

    def __init__(self, *args):
        super().__init__(*args)
        self._len = len(self)

    def __getitem__(self, idx):
        return (self.at(i) for i in range(idx.start, idx.stop, idx.step or 1))

    def at(self, idx):
        idx %= self._len
        return super().__getitem__(idx)

    def __setitem__(self, idx, value):
        idx %= len(self)
        return super().__setitem__(idx, value)


def Grid(cols, rows):
    return wraplist(wraplist(Cell() for _ in range(cols)) for _ in range(rows))


class Cell():

    def __init__(self, age=None, c=None, lifetime=None):
        self.age = age
        self.c = c
        self.lifetime = lifetime

    def __repr__(self):
        return f"<{self.age}/{self.lifetime} {'A' if self else '_'}>"

    def __bool__(self):
        return (self.age is not None) and (0 < self.age < self.lifetime)

    dead = property(lambda self: not self)

    def born(self, c=None, age_shift=1):
        self.c = c
        self.age = (-10 - age_shift) if c else 1
        self.lifetime = int(random_exp(25, 15, .3))

    def tick(self):
        if self.age is not None:
            self.age += 1

    def copy(self):
        return Cell(self.age, self.c, self.lifetime)

    def render(self):
        return (
            " " if self.age is None
            else self.c if self.age <= 0
            # else "." if self.dead
            else DECAY[min(len(DECAY) - 1, self.age - self.lifetime)] if self.dead
            else ALIVE[min(len(ALIVE) - 1, self.age - 1)])

    @property
    def buried(self):
        return self.age and self.age >= (self.lifetime + len(DECAY))

    def kill(self, offset=0):
        if self.age is not None:
            self.age = self.lifetime + offset


def main():

    print("")
    time.sleep(2)

    W, H = get_terminal_size()
    cols = at_most(W, 120)
    rows = at_most(H, 50)
    cols -= 2
    rows -= 3
    row_offset = 0
    col_offset = 0
    grid = Grid(cols, rows)

    opts = [f"This is {opt}" for opt in OPTS]
    shuffle(opts)

    fonts = Figlet().getFonts()
    font = ""

    def set_text(text, center=False):
        nonlocal font
        font = choice(fonts)
        fig = Figlet(font)
        text = fig.renderText(text.upper())
        text = text.splitlines()
        if not text:
            return
        height = len(text)
        width = max(map(len, text))
        if center:
            r_off = max(0, (rows - height) // 2)
            c_off = max(0, (cols - width) // 2)
        else:
            r_off = randrange(0, max(1, rows-height))
            c_off = randrange(0, max(1, cols-width))

        for r, line in enumerate(text):
            for c, char in enumerate(line):
                if char != " ":
                    grid.at(r + r_off + row_offset).at(c + c_off + col_offset).born(char, c + randrange(1, 5))

    def cleanse():
        for r in range(rows):
            for c in range(cols):
                grid.at(r).at(c).kill(randrange(0, len(DECAY)))

    ansi.clear_screen()
    ansi.hide_cursor()

    offset = (W - cols) // 2
    ansi.move(0, offset)
    ansi.write("┌" + "─" * cols + "┐")
    for i in range(rows):
        ansi.move(i + 2, offset)
        ansi.write("│")
        ansi.move_horizontal(offset + cols + 1)
        ansi.write("│")
    ansi.move(i + 3, offset)
    ansi.write("└" + "─" * cols + "┘")
    set_text(opts[1], True)
    chars = []
    n_visible = 1
    timer = Timer(expiration=300)
    blank_timer = None
    input_timer = None

    try:
        for keys in keyboard_listener(0.02):
            if timer.expired:
                break
            if 'esc' == keys:
                break
            elif 'heartbeat' == keys:
                if chars:
                    if input_timer.expired:
                        input_timer = None
                        text = "".join(chars).strip()
                        set_text(text.upper())
                        chars.clear()
                elif n_visible:
                    pass
                elif not blank_timer:
                    blank_timer = Timer(expiration=3)
                elif blank_timer.expired:
                    blank_timer = None
                    set_text("Type Something")
            elif 'enter' == keys:
                text = opts[0]
                opts.append(opts.pop(0))
                set_text(text)
            elif 'space' == keys:
                if chars:
                    chars.append(' ')
            elif 'up' == keys:
                row_offset -= 1
            elif 'down' == keys:
                row_offset += 1
            elif 'right' == keys:
                col_offset -= 1
            elif 'left' == keys:
                col_offset += 1
            elif keys == "delete":
                cleanse()
            elif keys in string.printable:
                input_timer = Timer(expiration=1)
                chars.append(keys)

            for i in range(rows):
                row = grid.at(i+row_offset)
                line = "".join(row.at(j+col_offset).render() for j in range(cols))
                ansi.move(i + 2, offset + 1)
                ansi.write(line)

            n_visible = 0
            next_grid = Grid(cols, rows)
            for r in range(rows):
                for c in range(cols):
                    x = grid.at(r).at(c).copy()
                    alive = bool(x)
                    x.tick()
                    n_visible += (x.age is not None)
                    n = sum(bool(cell) for row in grid[r - 1:r + 2] for cell in row[c - 1:c + 2]) - alive
                    if (n == 3) or (alive and n == 2):
                        if not alive:
                            x.born()
                    elif alive:
                        x.kill()
                        assert not x
                    elif x.buried:
                        x = Cell()
                        assert not x
                    next_grid.at(r)[c] = x
            grid = next_grid

            ansi.home()
            ansi.write(font)
    except KeyboardInterrupt:
        pass
    finally:
        ansi.clear_screen()
        ansi.show_cursor()


if __name__ == '__main__':
    main()
