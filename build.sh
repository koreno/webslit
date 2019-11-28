#!/bin/bash
docker build . -t 110450271409.dkr.ecr.eu-west-1.amazonaws.com/dev/orion:infra-webslit -t webslit
docker push 110450271409.dkr.ecr.eu-west-1.amazonaws.com/dev/orion:infra-webslit