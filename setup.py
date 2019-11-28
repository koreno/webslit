import codecs
from setuptools import setup
from webslit._version import __version__ as version


with codecs.open('README.rst', encoding='utf-8') as f:
    long_description = f.read()


setup(
    name='webslit',
    version=version,
    description='Web based ssh client',
    long_description=long_description,
    author='Shengdun Hua',
    author_email='webmaster0115@gmail.com',
    url='https://github.com/huashengdun/webslit',
    packages=['webslit'],
    entry_points='''
    [console_scripts]
    wssh = webslit.main:main
    ''',
    license='MIT',
    include_package_data=True,
    classifiers=[
        'Programming Language :: Python',
        'Programming Language :: Python :: 2',
        'Programming Language :: Python :: 2.7',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.4',
        'Programming Language :: Python :: 3.5',
        'Programming Language :: Python :: 3.6',
        'Programming Language :: Python :: 3.7',
    ],
    install_requires=[
        'tornado>=4.5.0',
        'paramiko>=2.3.1',
    ],
)
