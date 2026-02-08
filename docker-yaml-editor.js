/**
 * Docker YAML Editor
 * A self-contained YAML editor for Docker Compose/Stack files
 * Supports Docker Compose v3.x specification
 */
(function(global) {
    'use strict';

    // ============================================
    // BUNDLED YAML PARSER (Minimal implementation)
    // ============================================
    const YamlParser = {
        parse: function(text) {
            const lines = text.split('\n');
            const result = {};
            // Stack stores the current context: obj is the object we're adding to
            const stack = [{ indent: -1, obj: result, key: 'root' }];
            let errors = [];
            let lineNum = 0;
            let indentUnit = 0; // Detected indentation unit (usually 2)
            let lastIndent = 0;

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];
                lineNum = lineIdx + 1;
                const trimmed = line.trim();

                // Skip empty lines and comments
                if (trimmed === '' || trimmed.startsWith('#')) continue;

                const indent = line.search(/\S/);
                if (indent === -1) continue;

                // Check for tabs (not allowed in YAML)
                if (line.includes('\t')) {
                    errors.push({ line: lineNum, message: 'Tabs are not allowed in YAML, use spaces', column: line.indexOf('\t') + 1, severity: 'error' });
                }

                // Detect and validate indentation
                if (indent > 0 && indentUnit === 0) {
                    // First indented line establishes the unit
                    indentUnit = indent;
                }

                if (indentUnit > 0 && indent > 0) {
                    // Check if indentation is a multiple of the unit
                    if (indent % indentUnit !== 0) {
                        errors.push({
                            line: lineNum,
                            message: `Inconsistent indentation: expected multiple of ${indentUnit} spaces, got ${indent}`,
                            column: 1,
                            severity: 'error'
                        });
                    }

                    // Check for indentation jumping too far (more than one level at a time)
                    if (indent > lastIndent + indentUnit && lastIndent >= 0) {
                        errors.push({
                            line: lineNum,
                            message: `Indentation increased by ${indent - lastIndent} spaces, expected at most ${indentUnit}`,
                            column: 1,
                            severity: 'error'
                        });
                    }
                }

                lastIndent = indent;

                // Pop stack to find parent with smaller indent
                while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
                    stack.pop();
                }

                const parent = stack[stack.length - 1];
                const target = parent.obj;

                // Check if we're adding to the right type of container
                if (trimmed.startsWith('-') && !Array.isArray(target)) {
                    errors.push({
                        line: lineNum,
                        message: 'List item found but parent is not a list. Check indentation.',
                        column: 1,
                        severity: 'error'
                    });
                }

                // Handle list items
                if (trimmed.startsWith('- ')) {
                    const value = trimmed.slice(2).trim();

                    // Ensure target is an array
                    if (!Array.isArray(target)) continue;

                    // Check if it's a quoted string (don't parse as key:value)
                    const isQuoted = (value.startsWith('"') && value.endsWith('"')) ||
                                    (value.startsWith("'") && value.endsWith("'"));

                    if (value === '' || (!isQuoted && value.includes(':'))) {
                        // List item with nested object
                        if (value === '') {
                            // Block style: - \n  key: value
                            const obj = {};
                            target.push(obj);
                            stack.push({ indent: indent, obj: obj });
                        } else {
                            // Inline: - key: value
                            const colonIdx = value.indexOf(':');
                            const key = value.slice(0, colonIdx).trim();
                            const val = value.slice(colonIdx + 1).trim();
                            const obj = {};
                            if (val === '') {
                                obj[key] = {};
                                target.push(obj);
                                stack.push({ indent: indent, obj: obj[key] });
                            } else {
                                obj[key] = this.parseValue(val);
                                target.push(obj);
                            }
                        }
                    } else {
                        // Simple value
                        target.push(this.parseValue(value));
                    }
                    continue;
                }

                // Handle bare list item (just -)
                if (trimmed === '-') {
                    if (Array.isArray(target)) {
                        const obj = {};
                        target.push(obj);
                        stack.push({ indent: indent, obj: obj });
                    }
                    continue;
                }

                // Handle key: value pairs
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx > 0) {
                    const key = trimmed.slice(0, colonIdx).trim();
                    const valueStr = trimmed.slice(colonIdx + 1).trim();

                    // Determine if next line indicates array or nested object
                    let nextIndent = -1;
                    let nextIsArray = false;
                    for (let i = lineIdx + 1; i < lines.length; i++) {
                        const nextLine = lines[i];
                        const nextTrimmed = nextLine.trim();
                        if (nextTrimmed === '' || nextTrimmed.startsWith('#')) continue;
                        nextIndent = nextLine.search(/\S/);
                        nextIsArray = nextTrimmed.startsWith('-');
                        break;
                    }

                    if (valueStr === '' || valueStr === '|' || valueStr === '>' || valueStr === '|-' || valueStr === '>-') {
                        // Empty value - could be object, array, or multiline string
                        if (nextIndent > indent) {
                            if (nextIsArray) {
                                target[key] = [];
                                stack.push({ indent: indent, obj: target[key] });
                            } else {
                                target[key] = {};
                                stack.push({ indent: indent, obj: target[key] });
                            }
                        } else {
                            // No nested content, treat as empty/null
                            target[key] = valueStr === '' ? null : '';
                        }
                    } else if (valueStr === '[]') {
                        target[key] = [];
                    } else if (valueStr === '{}') {
                        target[key] = {};
                    } else {
                        target[key] = this.parseValue(valueStr);
                    }
                } else if (colonIdx === -1 && !trimmed.startsWith('-')) {
                    // Bare value (shouldn't normally happen in valid YAML)
                    errors.push({ line: lineNum, message: 'Invalid YAML syntax', column: 1 });
                }
            }

            return { data: result, errors };
        },

        parseValue: function(str) {
            if (str === 'true' || str === 'True' || str === 'TRUE') return true;
            if (str === 'false' || str === 'False' || str === 'FALSE') return false;
            if (str === 'null' || str === 'Null' || str === 'NULL' || str === '~') return null;
            if (/^-?\d+$/.test(str)) return parseInt(str, 10);
            if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
            if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
                return str.slice(1, -1);
            }
            return str;
        },

        parseKeyValue: function(str, lineNum, errors) {
            const colonIdx = str.indexOf(':');
            if (colonIdx === -1) return null;
            const key = str.slice(0, colonIdx).trim();
            const value = str.slice(colonIdx + 1).trim();
            return { key, value: this.parseValue(value) };
        },

        stringify: function(obj, indent = 0) {
            let result = '';
            const spaces = '  '.repeat(indent);

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    if (typeof item === 'object' && item !== null) {
                        result += spaces + '-\n' + this.stringify(item, indent + 1);
                    } else {
                        result += spaces + '- ' + this.valueToString(item) + '\n';
                    }
                }
            } else if (typeof obj === 'object' && obj !== null) {
                for (const [key, value] of Object.entries(obj)) {
                    if (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0) {
                        result += spaces + key + ':\n' + this.stringify(value, indent + 1);
                    } else if (Array.isArray(value)) {
                        result += spaces + key + ':\n' + this.stringify(value, indent + 1);
                    } else {
                        result += spaces + key + ': ' + this.valueToString(value) + '\n';
                    }
                }
            }

            return result;
        },

        valueToString: function(val) {
            if (val === null) return 'null';
            if (typeof val === 'boolean') return val.toString();
            if (typeof val === 'number') return val.toString();
            if (typeof val === 'string') {
                if (val.includes(':') || val.includes('#') || val.includes("'") || val.startsWith(' ') || val.endsWith(' ')) {
                    return '"' + val.replace(/"/g, '\\"') + '"';
                }
                return val;
            }
            return String(val);
        }
    };

    // ============================================
    // DOCKER COMPOSE V3.X SCHEMA
    // ============================================
    const DockerComposeSchema = {
        version: {
            type: 'string',
            description: 'Specifies the Compose file format version',
            values: ['3', '3.0', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9'],
            required: false,
            example: '"3.8"'
        },
        services: {
            type: 'object',
            description: 'Define the services (containers) that make up your application',
            children: {
                '*': {
                    type: 'object',
                    description: 'Service definition',
                    children: {
                        image: {
                            type: 'string',
                            description: 'Specify the image to start the container from. Can be a repository/tag or image ID',
                            example: 'nginx:latest, redis:6.2-alpine, myregistry.com/myimage:v1.0'
                        },
                        build: {
                            type: ['string', 'object'],
                            description: 'Configuration options applied at build time. Can be a path to build context or an object',
                            children: {
                                context: { type: 'string', description: 'Path to directory containing Dockerfile or git repository URL' },
                                dockerfile: { type: 'string', description: 'Alternate Dockerfile name' },
                                args: { type: 'object', description: 'Build arguments (ARG values)' },
                                cache_from: { type: 'array', description: 'Images to use as cache sources' },
                                labels: { type: 'object', description: 'Labels to add to the built image' },
                                network: { type: 'string', description: 'Network mode during build', values: ['host', 'none', 'default'] },
                                shm_size: { type: 'string', description: 'Size of /dev/shm (e.g., "2gb")' },
                                target: { type: 'string', description: 'Build stage to target in multi-stage Dockerfile' }
                            }
                        },
                        command: {
                            type: ['string', 'array'],
                            description: 'Override the default command. Can be a string or list',
                            example: '["python", "app.py"] or "python app.py"'
                        },
                        entrypoint: {
                            type: ['string', 'array'],
                            description: 'Override the default entrypoint',
                            example: '["/entrypoint.sh"] or "/entrypoint.sh"'
                        },
                        container_name: {
                            type: 'string',
                            description: 'Custom container name (not recommended for Swarm mode)'
                        },
                        depends_on: {
                            type: ['array', 'object'],
                            description: 'Express dependency between services. Services start in dependency order',
                            example: '["db", "redis"]'
                        },
                        deploy: {
                            type: 'object',
                            description: 'Deployment and running configuration (Swarm mode)',
                            children: {
                                mode: {
                                    type: 'string',
                                    description: 'Replication mode',
                                    values: ['replicated', 'global']
                                },
                                replicas: {
                                    type: 'number',
                                    description: 'Number of containers to run (only for replicated mode)'
                                },
                                endpoint_mode: {
                                    type: 'string',
                                    description: 'Service discovery mode',
                                    values: ['vip', 'dnsrr']
                                },
                                labels: {
                                    type: ['object', 'array'],
                                    description: 'Labels for the service (not containers). Can be object or array of strings'
                                },
                                placement: {
                                    type: 'object',
                                    description: 'Placement constraints and preferences',
                                    children: {
                                        constraints: { type: 'array', description: 'Placement constraints', example: '["node.role == manager"]' },
                                        preferences: { type: 'array', description: 'Placement preferences' },
                                        max_replicas_per_node: { type: 'number', description: 'Max replicas per node' }
                                    }
                                },
                                resources: {
                                    type: 'object',
                                    description: 'Resource constraints',
                                    children: {
                                        limits: {
                                            type: 'object',
                                            description: 'Hard resource limits',
                                            children: {
                                                cpus: { type: 'string', description: 'CPU limit (e.g., "0.5")' },
                                                memory: { type: 'string', description: 'Memory limit (e.g., "512M")' },
                                                pids: { type: 'number', description: 'Process ID limit' }
                                            }
                                        },
                                        reservations: {
                                            type: 'object',
                                            description: 'Resource reservations',
                                            children: {
                                                cpus: { type: 'string', description: 'CPU reservation' },
                                                memory: { type: 'string', description: 'Memory reservation' },
                                                generic_resources: { type: 'array', description: 'Generic resources' }
                                            }
                                        }
                                    }
                                },
                                restart_policy: {
                                    type: 'object',
                                    description: 'Restart policy for containers',
                                    children: {
                                        condition: { type: 'string', description: 'When to restart', values: ['none', 'on-failure', 'any'] },
                                        delay: { type: 'string', description: 'Delay between restarts (e.g., "5s")' },
                                        max_attempts: { type: 'number', description: 'Maximum restart attempts' },
                                        window: { type: 'string', description: 'Time window for restart evaluation' }
                                    }
                                },
                                rollback_config: {
                                    type: 'object',
                                    description: 'Rollback configuration',
                                    children: {
                                        parallelism: { type: 'number', description: 'Containers to rollback at once' },
                                        delay: { type: 'string', description: 'Delay between rollback batches' },
                                        failure_action: { type: 'string', values: ['continue', 'pause'] },
                                        monitor: { type: 'string', description: 'Monitor duration after rollback' },
                                        max_failure_ratio: { type: 'number', description: 'Failure rate to tolerate' },
                                        order: { type: 'string', values: ['start-first', 'stop-first'] }
                                    }
                                },
                                update_config: {
                                    type: 'object',
                                    description: 'Update configuration',
                                    children: {
                                        parallelism: { type: 'number', description: 'Containers to update at once' },
                                        delay: { type: 'string', description: 'Delay between updates' },
                                        failure_action: { type: 'string', values: ['continue', 'pause', 'rollback'] },
                                        monitor: { type: 'string', description: 'Monitor duration after update' },
                                        max_failure_ratio: { type: 'number', description: 'Failure rate to tolerate' },
                                        order: { type: 'string', values: ['start-first', 'stop-first'] }
                                    }
                                }
                            }
                        },
                        dns: {
                            type: ['string', 'array'],
                            description: 'Custom DNS servers'
                        },
                        dns_search: {
                            type: ['string', 'array'],
                            description: 'Custom DNS search domains'
                        },
                        environment: {
                            type: ['object', 'array'],
                            description: 'Environment variables. Can be an object or array of KEY=value strings',
                            example: 'NODE_ENV: production or - NODE_ENV=production'
                        },
                        env_file: {
                            type: ['string', 'array'],
                            description: 'Load environment variables from file(s)',
                            example: '.env or [".env", ".env.local"]'
                        },
                        expose: {
                            type: 'array',
                            description: 'Expose ports without publishing to host (internal only)',
                            example: '["3000", "8000"]'
                        },
                        external_links: {
                            type: 'array',
                            description: 'Link to containers outside this compose file'
                        },
                        extra_hosts: {
                            type: 'array',
                            description: 'Add hostname mappings to /etc/hosts',
                            example: '["host1:192.168.1.1"]'
                        },
                        healthcheck: {
                            type: 'object',
                            description: 'Container health check configuration',
                            children: {
                                test: { type: ['string', 'array'], description: 'Command to run for health check', example: '["CMD", "curl", "-f", "http://localhost/health"]' },
                                interval: { type: 'string', description: 'Time between health checks', example: '30s' },
                                timeout: { type: 'string', description: 'Timeout for health check', example: '10s' },
                                retries: { type: 'number', description: 'Consecutive failures before unhealthy' },
                                start_period: { type: 'string', description: 'Start period for container initialization', example: '40s' },
                                disable: { type: 'boolean', description: 'Disable the healthcheck' }
                            }
                        },
                        hostname: {
                            type: 'string',
                            description: 'Container hostname'
                        },
                        init: {
                            type: 'boolean',
                            description: 'Run an init process inside the container'
                        },
                        labels: {
                            type: ['object', 'array'],
                            description: 'Container labels'
                        },
                        links: {
                            type: 'array',
                            description: 'Link to other services (legacy, use networks instead)'
                        },
                        logging: {
                            type: 'object',
                            description: 'Logging configuration',
                            children: {
                                driver: { type: 'string', description: 'Logging driver', values: ['json-file', 'syslog', 'journald', 'gelf', 'fluentd', 'awslogs', 'splunk', 'none'] },
                                options: { type: 'object', description: 'Driver-specific options' }
                            }
                        },
                        network_mode: {
                            type: 'string',
                            description: 'Network mode',
                            values: ['bridge', 'host', 'none', 'service:[service name]', 'container:[container name/id]']
                        },
                        networks: {
                            type: ['array', 'object'],
                            description: 'Networks to join. Can be a list or object with network-specific config',
                            children: {
                                '*': {
                                    type: 'object',
                                    children: {
                                        aliases: { type: 'array', description: 'Network aliases for this service' },
                                        ipv4_address: { type: 'string', description: 'Static IPv4 address' },
                                        ipv6_address: { type: 'string', description: 'Static IPv6 address' }
                                    }
                                }
                            }
                        },
                        pid: {
                            type: 'string',
                            description: 'PID mode',
                            values: ['host', 'service:[service name]']
                        },
                        ports: {
                            type: 'array',
                            description: 'Expose ports. Format: [HOST:]CONTAINER[/PROTOCOL]',
                            example: '["80:80", "443:443", "8080:80/tcp"]'
                        },
                        privileged: {
                            type: 'boolean',
                            description: 'Run container in privileged mode'
                        },
                        read_only: {
                            type: 'boolean',
                            description: 'Mount container root filesystem as read-only'
                        },
                        restart: {
                            type: 'string',
                            description: 'Restart policy (ignored in Swarm mode, use deploy.restart_policy)',
                            values: ['no', 'always', 'on-failure', 'unless-stopped']
                        },
                        secrets: {
                            type: 'array',
                            description: 'Secrets to mount in the container',
                            example: '["my_secret"]'
                        },
                        security_opt: {
                            type: 'array',
                            description: 'Security options'
                        },
                        shm_size: {
                            type: 'string',
                            description: 'Size of /dev/shm',
                            example: '64M'
                        },
                        stdin_open: {
                            type: 'boolean',
                            description: 'Keep STDIN open (equivalent to docker run -i)'
                        },
                        stop_grace_period: {
                            type: 'string',
                            description: 'Time to wait before force-killing container',
                            example: '10s'
                        },
                        stop_signal: {
                            type: 'string',
                            description: 'Signal to stop the container',
                            example: 'SIGTERM'
                        },
                        sysctls: {
                            type: ['object', 'array'],
                            description: 'Kernel parameters to set'
                        },
                        tmpfs: {
                            type: ['string', 'array'],
                            description: 'Mount temporary filesystem'
                        },
                        tty: {
                            type: 'boolean',
                            description: 'Allocate pseudo-TTY (equivalent to docker run -t)'
                        },
                        ulimits: {
                            type: 'object',
                            description: 'Override default ulimits',
                            children: {
                                nproc: { type: ['number', 'object'], description: 'Max number of processes' },
                                nofile: { type: ['number', 'object'], description: 'Max number of open files' }
                            }
                        },
                        user: {
                            type: 'string',
                            description: 'User to run as (UID:GID)',
                            example: '1000:1000'
                        },
                        userns_mode: {
                            type: 'string',
                            description: 'User namespace mode',
                            values: ['host']
                        },
                        volumes: {
                            type: 'array',
                            description: 'Mount volumes. Format: [SOURCE:]TARGET[:OPTIONS]',
                            example: '["./data:/app/data:ro", "logs:/var/log"]'
                        },
                        working_dir: {
                            type: 'string',
                            description: 'Working directory inside the container'
                        },
                        configs: {
                            type: 'array',
                            description: 'Configs to mount (Swarm mode)',
                            children: {
                                '*': {
                                    type: 'object',
                                    children: {
                                        source: { type: 'string', description: 'Config name' },
                                        target: { type: 'string', description: 'Mount path in container' },
                                        uid: { type: 'string', description: 'Owner UID' },
                                        gid: { type: 'string', description: 'Owner GID' },
                                        mode: { type: 'number', description: 'File mode (octal)', example: '0440' }
                                    }
                                }
                            }
                        },
                        cap_add: {
                            type: 'array',
                            description: 'Add container capabilities',
                            values: ['ALL', 'AUDIT_CONTROL', 'AUDIT_WRITE', 'BLOCK_SUSPEND', 'CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER', 'FSETID', 'IPC_LOCK', 'IPC_OWNER', 'KILL', 'LEASE', 'LINUX_IMMUTABLE', 'MAC_ADMIN', 'MAC_OVERRIDE', 'MKNOD', 'NET_ADMIN', 'NET_BIND_SERVICE', 'NET_BROADCAST', 'NET_RAW', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_BOOT', 'SYS_CHROOT', 'SYS_MODULE', 'SYS_NICE', 'SYS_PACCT', 'SYS_PTRACE', 'SYS_RAWIO', 'SYS_RESOURCE', 'SYS_TIME', 'SYS_TTY_CONFIG', 'SYSLOG', 'WAKE_ALARM']
                        },
                        cap_drop: {
                            type: 'array',
                            description: 'Drop container capabilities',
                            values: ['ALL', 'AUDIT_CONTROL', 'AUDIT_WRITE', 'BLOCK_SUSPEND', 'CHOWN', 'DAC_OVERRIDE', 'DAC_READ_SEARCH', 'FOWNER', 'FSETID', 'IPC_LOCK', 'IPC_OWNER', 'KILL', 'LEASE', 'LINUX_IMMUTABLE', 'MAC_ADMIN', 'MAC_OVERRIDE', 'MKNOD', 'NET_ADMIN', 'NET_BIND_SERVICE', 'NET_BROADCAST', 'NET_RAW', 'SETFCAP', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_BOOT', 'SYS_CHROOT', 'SYS_MODULE', 'SYS_NICE', 'SYS_PACCT', 'SYS_PTRACE', 'SYS_RAWIO', 'SYS_RESOURCE', 'SYS_TIME', 'SYS_TTY_CONFIG', 'SYSLOG', 'WAKE_ALARM']
                        },
                        cgroup_parent: {
                            type: 'string',
                            description: 'Parent cgroup for the container'
                        },
                        devices: {
                            type: 'array',
                            description: 'Device mappings',
                            example: '["/dev/ttyUSB0:/dev/ttyUSB0"]'
                        },
                        domainname: {
                            type: 'string',
                            description: 'Container domain name'
                        },
                        ipc: {
                            type: 'string',
                            description: 'IPC mode',
                            values: ['host', 'private', 'shareable', 'service:[service name]', 'container:[container name/id]']
                        },
                        isolation: {
                            type: 'string',
                            description: 'Container isolation technology (Windows only)',
                            values: ['default', 'process', 'hyperv']
                        },
                        mac_address: {
                            type: 'string',
                            description: 'Container MAC address'
                        },
                        platform: {
                            type: 'string',
                            description: 'Target platform',
                            example: 'linux/amd64'
                        },
                        profiles: {
                            type: 'array',
                            description: 'Profiles this service belongs to'
                        },
                        pull_policy: {
                            type: 'string',
                            description: 'Image pull policy',
                            values: ['always', 'never', 'missing', 'build']
                        },
                        runtime: {
                            type: 'string',
                            description: 'Runtime to use (e.g., nvidia)'
                        },
                        scale: {
                            type: 'number',
                            description: 'Number of containers (deprecated, use deploy.replicas)'
                        },
                        storage_opt: {
                            type: 'object',
                            description: 'Storage driver options'
                        }
                    }
                }
            }
        },
        networks: {
            type: 'object',
            description: 'Define networks for services to connect to',
            children: {
                '*': {
                    type: 'object',
                    description: 'Network definition',
                    children: {
                        driver: {
                            type: 'string',
                            description: 'Network driver',
                            values: ['bridge', 'overlay', 'host', 'none', 'macvlan', 'ipvlan']
                        },
                        driver_opts: {
                            type: 'object',
                            description: 'Driver-specific options'
                        },
                        attachable: {
                            type: 'boolean',
                            description: 'Allow standalone containers to attach (overlay only)'
                        },
                        enable_ipv6: {
                            type: 'boolean',
                            description: 'Enable IPv6 networking'
                        },
                        external: {
                            type: ['boolean', 'object'],
                            description: 'Network is managed outside this Compose file',
                            children: {
                                name: { type: 'string', description: 'External network name' }
                            }
                        },
                        internal: {
                            type: 'boolean',
                            description: 'Restrict external access to the network'
                        },
                        ipam: {
                            type: 'object',
                            description: 'IP Address Management configuration',
                            children: {
                                driver: { type: 'string', description: 'IPAM driver', values: ['default'] },
                                config: {
                                    type: 'array',
                                    description: 'IPAM configuration blocks',
                                    children: {
                                        '*': {
                                            type: 'object',
                                            children: {
                                                subnet: { type: 'string', description: 'Subnet in CIDR format', example: '172.28.0.0/16' },
                                                ip_range: { type: 'string', description: 'IP range for allocation' },
                                                gateway: { type: 'string', description: 'Gateway IP address' },
                                                aux_addresses: { type: 'object', description: 'Auxiliary addresses' }
                                            }
                                        }
                                    }
                                },
                                options: { type: 'object', description: 'Driver-specific options' }
                            }
                        },
                        labels: {
                            type: ['object', 'array'],
                            description: 'Network labels'
                        },
                        name: {
                            type: 'string',
                            description: 'Custom name for the network'
                        }
                    }
                }
            }
        },
        volumes: {
            type: 'object',
            description: 'Define named volumes for data persistence',
            children: {
                '*': {
                    type: ['object', 'null'],
                    description: 'Volume definition (null for default options)',
                    children: {
                        driver: {
                            type: 'string',
                            description: 'Volume driver',
                            values: ['local', 'nfs', 'cifs']
                        },
                        driver_opts: {
                            type: 'object',
                            description: 'Driver-specific options'
                        },
                        external: {
                            type: ['boolean', 'object'],
                            description: 'Volume is managed outside this Compose file',
                            children: {
                                name: { type: 'string', description: 'External volume name' }
                            }
                        },
                        labels: {
                            type: ['object', 'array'],
                            description: 'Volume labels'
                        },
                        name: {
                            type: 'string',
                            description: 'Custom name for the volume'
                        }
                    }
                }
            }
        },
        configs: {
            type: 'object',
            description: 'Define configurations for services (Swarm mode)',
            children: {
                '*': {
                    type: 'object',
                    description: 'Config definition',
                    children: {
                        file: {
                            type: 'string',
                            description: 'Path to config file'
                        },
                        external: {
                            type: ['boolean', 'object'],
                            description: 'Config is managed outside this Compose file',
                            children: {
                                name: { type: 'string', description: 'External config name' }
                            }
                        },
                        name: {
                            type: 'string',
                            description: 'Custom name for the config'
                        },
                        template_driver: {
                            type: 'string',
                            description: 'Template driver for config'
                        }
                    }
                }
            }
        },
        secrets: {
            type: 'object',
            description: 'Define secrets for services (Swarm mode)',
            children: {
                '*': {
                    type: 'object',
                    description: 'Secret definition',
                    children: {
                        file: {
                            type: 'string',
                            description: 'Path to secret file'
                        },
                        external: {
                            type: ['boolean', 'object'],
                            description: 'Secret is managed outside this Compose file',
                            children: {
                                name: { type: 'string', description: 'External secret name' }
                            }
                        },
                        name: {
                            type: 'string',
                            description: 'Custom name for the secret'
                        },
                        template_driver: {
                            type: 'string',
                            description: 'Template driver for secret'
                        }
                    }
                }
            }
        },
        x: {
            type: 'any',
            description: 'Extension fields. Any key starting with "x-" can contain custom data',
            isExtension: true
        }
    };

    // ============================================
    // YAML SYNTAX TOKENIZER
    // ============================================
    const YamlTokenizer = {
        tokenize: function(text) {
            const tokens = [];
            const lines = text.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineTokens = this.tokenizeLine(line, i);
                tokens.push(lineTokens);
            }

            return tokens;
        },

        tokenizeLine: function(line, lineNum) {
            const tokens = [];
            let pos = 0;

            if (line.trim() === '') {
                tokens.push({ type: 'whitespace', value: line, start: 0, end: line.length });
                return tokens;
            }

            // Leading whitespace
            const leadingWs = line.match(/^(\s*)/);
            if (leadingWs && leadingWs[1].length > 0) {
                tokens.push({ type: 'indent', value: leadingWs[1], start: 0, end: leadingWs[1].length });
                pos = leadingWs[1].length;
            }

            const rest = line.slice(pos);

            // Comment
            if (rest.startsWith('#')) {
                tokens.push({ type: 'comment', value: rest, start: pos, end: line.length });
                return tokens;
            }

            // List item
            if (rest.startsWith('- ')) {
                tokens.push({ type: 'list-marker', value: '- ', start: pos, end: pos + 2 });
                pos += 2;
            } else if (rest === '-') {
                tokens.push({ type: 'list-marker', value: '-', start: pos, end: pos + 1 });
                return tokens;
            }

            // Key: value or just value
            const remaining = line.slice(pos);
            const colonMatch = remaining.match(/^([^:]+)(:)(\s*)(.*)/);

            if (colonMatch) {
                const key = colonMatch[1];
                const colon = colonMatch[2];
                const space = colonMatch[3];
                const value = colonMatch[4];

                tokens.push({ type: 'key', value: key, start: pos, end: pos + key.length });
                pos += key.length;
                tokens.push({ type: 'colon', value: colon, start: pos, end: pos + 1 });
                pos += 1;

                if (space) {
                    tokens.push({ type: 'whitespace', value: space, start: pos, end: pos + space.length });
                    pos += space.length;
                }

                if (value) {
                    const valueToken = this.tokenizeValue(value, pos);
                    tokens.push(valueToken);
                }
            } else {
                // Plain value (e.g., in a list)
                const valueToken = this.tokenizeValue(remaining, pos);
                tokens.push(valueToken);
            }

            return tokens;
        },

        tokenizeValue: function(value, start) {
            // Check for inline comment
            let actualValue = value;
            let comment = null;
            const commentMatch = value.match(/^([^#]*\S)\s+(#.*)$/);
            if (commentMatch && !value.startsWith('"') && !value.startsWith("'")) {
                actualValue = commentMatch[1];
                comment = commentMatch[2];
            }

            let type = 'value-string';
            const trimmed = actualValue.trim();

            if (trimmed === '' || trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') {
                type = 'value-multiline';
            } else if (trimmed === 'true' || trimmed === 'false' || trimmed === 'True' || trimmed === 'False') {
                type = 'value-boolean';
            } else if (trimmed === 'null' || trimmed === 'Null' || trimmed === '~') {
                type = 'value-null';
            } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
                type = 'value-number';
            } else if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
                type = 'value-quoted';
            } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                type = 'value-inline';
            }

            return {
                type,
                value: actualValue,
                start,
                end: start + actualValue.length,
                comment: comment ? { value: comment, start: start + value.indexOf(comment), end: start + value.length } : null
            };
        }
    };

    // ============================================
    // DOCKER COMPOSE VALIDATOR
    // ============================================
    const DockerComposeValidator = {
        // Keys that allow arbitrary sub-keys (free-form objects)
        freeFormKeys: new Set([
            'driver_opts', 'options', 'labels', 'args', 'environment',
            'sysctls', 'extra_hosts', 'storage_opt', 'aux_addresses'
        ]),

        // Keys that should NEVER appear at root level (indicates wrong indentation)
        serviceOnlyKeys: new Set([
            'image', 'build', 'command', 'entrypoint', 'container_name',
            'depends_on', 'deploy', 'ports', 'expose', 'volumes', 'environment',
            'env_file', 'healthcheck', 'logging', 'networks', 'restart',
            'secrets', 'configs', 'labels', 'working_dir', 'user', 'privileged',
            'cap_add', 'cap_drop', 'devices', 'dns', 'dns_search', 'tmpfs',
            'hostname', 'domainname', 'shm_size', 'stop_grace_period', 'stop_signal',
            'stdin_open', 'tty', 'ulimits', 'init', 'read_only', 'pid', 'ipc',
            'security_opt', 'sysctls', 'userns_mode', 'isolation', 'platform'
        ]),

        // Keys that belong under deploy (indicates wrong indentation)
        deployOnlyKeys: new Set([
            'mode', 'replicas', 'placement', 'resources', 'restart_policy',
            'update_config', 'rollback_config', 'endpoint_mode'
        ]),

        validate: function(text, parsedData) {
            const errors = [];
            const lines = text.split('\n');

            if (!parsedData || Object.keys(parsedData).length === 0) {
                return errors;
            }

            // Validate top-level keys
            for (const key of Object.keys(parsedData)) {
                if (key.startsWith('x-')) continue; // Extension fields are allowed
                if (!DockerComposeSchema[key]) {
                    const lineNum = this.findKeyLine(lines, key, 0);

                    // Check if this is a service-level key at root (wrong indentation)
                    if (this.serviceOnlyKeys.has(key)) {
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `"${key}" should be inside a service definition, not at root level. Check indentation.`,
                            severity: 'error'
                        });
                    } else if (this.deployOnlyKeys.has(key)) {
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `"${key}" should be inside a deploy section, not at root level. Check indentation.`,
                            severity: 'error'
                        });
                    } else {
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `Unknown top-level key: "${key}"`,
                            validKeys: Object.keys(DockerComposeSchema).filter(k => k !== 'x'),
                            severity: 'error'
                        });
                    }
                }
            }

            // Validate version
            if (parsedData.version) {
                const validVersions = DockerComposeSchema.version.values;
                const version = String(parsedData.version).replace(/['"]/g, '');
                if (!validVersions.includes(version)) {
                    const lineNum = this.findKeyLine(lines, 'version', 0);
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: `Invalid version: "${version}"`,
                        validValues: validVersions,
                        severity: 'warning'
                    });
                }
            }

            // Validate services
            if (parsedData.services && typeof parsedData.services === 'object') {
                this.validateServices(parsedData.services, lines, errors);
            }

            // Validate networks
            if (parsedData.networks && typeof parsedData.networks === 'object') {
                this.validateSection(parsedData.networks, lines, errors, 'networks', DockerComposeSchema.networks.children['*']);
            }

            // Validate volumes
            if (parsedData.volumes && typeof parsedData.volumes === 'object') {
                this.validateSection(parsedData.volumes, lines, errors, 'volumes', DockerComposeSchema.volumes.children['*']);
            }

            // Validate configs
            if (parsedData.configs && typeof parsedData.configs === 'object') {
                this.validateSection(parsedData.configs, lines, errors, 'configs', DockerComposeSchema.configs.children['*']);
            }

            // Validate secrets
            if (parsedData.secrets && typeof parsedData.secrets === 'object') {
                this.validateSection(parsedData.secrets, lines, errors, 'secrets', DockerComposeSchema.secrets.children['*']);
            }

            return errors;
        },

        validateServices: function(services, lines, errors) {
            const serviceSchema = DockerComposeSchema.services.children['*'];

            for (const [serviceName, serviceConfig] of Object.entries(services)) {
                if (!serviceConfig || typeof serviceConfig !== 'object') continue;

                // Check for required fields: either image or build
                if (!serviceConfig.image && !serviceConfig.build) {
                    const lineNum = this.findKeyLine(lines, serviceName, 0);
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: `Service "${serviceName}" must have either "image" or "build" defined`,
                        severity: 'error'
                    });
                }

                // Validate service keys
                for (const key of Object.keys(serviceConfig)) {
                    if (key.startsWith('x-')) continue; // Extension fields
                    if (!serviceSchema.children[key]) {
                        const lineNum = this.findKeyLine(lines, key, this.findKeyLine(lines, serviceName, 0));
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `Unknown service key: "${key}" in service "${serviceName}"`,
                            validKeys: Object.keys(serviceSchema.children),
                            severity: 'error'
                        });
                    } else {
                        // Validate nested structures (but skip arrays and free-form keys)
                        const value = serviceConfig[key];
                        if (!Array.isArray(value) && !this.freeFormKeys.has(key)) {
                            this.validateNestedConfig(value, key, serviceSchema.children[key], lines, errors, serviceName);
                        }
                    }
                }
            }
        },

        validateSection: function(section, lines, errors, sectionName, schema) {
            // Schema might not have children if it accepts any structure (like external: true)
            if (!schema) return;

            const schemaChildren = schema.children || {};

            for (const [itemName, itemConfig] of Object.entries(section)) {
                if (itemConfig === null) continue; // null is valid for volumes/networks
                if (typeof itemConfig === 'boolean') continue; // external: true at top level
                if (typeof itemConfig !== 'object') continue;

                for (const key of Object.keys(itemConfig)) {
                    if (key.startsWith('x-')) continue;
                    // Skip validation for free-form keys
                    if (this.freeFormKeys.has(key)) continue;
                    // Allow 'name' key everywhere (used with external)
                    if (key === 'name') continue;
                    // Allow 'external' as boolean or object
                    if (key === 'external') continue;

                    if (Object.keys(schemaChildren).length > 0 && !schemaChildren[key]) {
                        const lineNum = this.findKeyLine(lines, key, this.findKeyLine(lines, itemName, 0));
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `Unknown key: "${key}" in ${sectionName}."${itemName}"`,
                            validKeys: Object.keys(schemaChildren),
                            severity: 'error'
                        });
                    }
                }
            }
        },

        validateNestedConfig: function(config, key, schema, lines, errors, context) {
            if (!schema || config === null || config === undefined) return;

            // Skip validation for free-form keys
            if (this.freeFormKeys.has(key)) return;

            // Skip arrays - they contain simple values or objects that are harder to validate
            if (Array.isArray(config)) return;

            // Validate enum values
            if (schema.values && typeof config === 'string') {
                if (!schema.values.includes(config) && !schema.values.some(v => config.startsWith(v.split('[')[0]))) {
                    const lineNum = this.findKeyLine(lines, key, 0);
                    errors.push({
                        line: lineNum,
                        column: 1,
                        message: `Invalid value "${config}" for "${key}"`,
                        validValues: schema.values,
                        severity: 'warning'
                    });
                }
            }

            // Validate nested objects
            if (schema.children && typeof config === 'object') {
                for (const subKey of Object.keys(config)) {
                    if (subKey.startsWith('x-')) continue;
                    // Skip free-form keys
                    if (this.freeFormKeys.has(subKey)) continue;

                    const subSchema = schema.children[subKey] || schema.children['*'];
                    if (!subSchema && !schema.children['*']) {
                        const lineNum = this.findKeyLine(lines, subKey, 0);
                        errors.push({
                            line: lineNum,
                            column: 1,
                            message: `Unknown key: "${subKey}" in ${context}.${key}`,
                            validKeys: Object.keys(schema.children).filter(k => k !== '*'),
                            severity: 'warning'
                        });
                    } else if (subSchema) {
                        this.validateNestedConfig(config[subKey], subKey, subSchema, lines, errors, `${context}.${key}`);
                    }
                }
            }
        },

        findKeyLine: function(lines, key, startLine) {
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const keyPattern = new RegExp(`^\\s*-?\\s*${escapedKey}\\s*:`);
            for (let i = startLine; i < lines.length; i++) {
                if (keyPattern.test(lines[i])) {
                    return i + 1;
                }
            }
            return startLine + 1;
        }
    };

    // ============================================
    // AUTOCOMPLETE ENGINE
    // ============================================
    const AutocompleteEngine = {
        // Priority order for service keys (most commonly used first)
        serviceKeyPriority: [
            'image', 'build', 'container_name', 'command', 'entrypoint',
            'environment', 'env_file', 'ports', 'expose', 'volumes',
            'networks', 'depends_on', 'deploy', 'restart', 'healthcheck',
            'secrets', 'configs', 'labels', 'logging', 'working_dir',
            'user', 'privileged', 'cap_add', 'cap_drop', 'devices',
            'dns', 'dns_search', 'extra_hosts', 'hostname', 'domainname',
            'init', 'pid', 'ipc', 'shm_size', 'stdin_open', 'tty',
            'stop_signal', 'stop_grace_period', 'security_opt', 'sysctls',
            'ulimits', 'userns_mode', 'platform', 'runtime', 'isolation',
            'network_mode', 'tmpfs', 'read_only', 'mac_address',
            'cgroup_parent', 'links', 'external_links', 'profiles',
            'pull_policy', 'scale', 'storage_opt'
        ],

        // Priority order for deploy keys
        deployKeyPriority: [
            'mode', 'replicas', 'placement', 'resources', 'restart_policy',
            'update_config', 'rollback_config', 'labels', 'endpoint_mode'
        ],

        // Priority order for top-level keys
        topLevelKeyPriority: [
            'version', 'services', 'networks', 'volumes', 'secrets', 'configs'
        ],

        // Priority order for network keys
        networkKeyPriority: [
            'driver', 'driver_opts', 'external', 'name', 'attachable',
            'internal', 'ipam', 'labels', 'enable_ipv6'
        ],

        // Priority order for volume keys
        volumeKeyPriority: [
            'driver', 'driver_opts', 'external', 'name', 'labels'
        ],

        // Priority order for secret/config keys
        secretKeyPriority: [
            'file', 'external', 'name', 'template_driver'
        ],

        // Priority order for healthcheck keys
        healthcheckKeyPriority: [
            'test', 'interval', 'timeout', 'retries', 'start_period', 'disable'
        ],

        // Priority order for resources keys
        resourcesKeyPriority: [
            'limits', 'reservations'
        ],

        // Priority order for placement keys
        placementKeyPriority: [
            'constraints', 'preferences', 'max_replicas_per_node'
        ],

        // Priority for update/rollback config
        updateConfigKeyPriority: [
            'parallelism', 'delay', 'failure_action', 'monitor', 'max_failure_ratio', 'order'
        ],

        // Priority for restart_policy
        restartPolicyKeyPriority: [
            'condition', 'delay', 'max_attempts', 'window'
        ],

        // Priority for build keys
        buildKeyPriority: [
            'context', 'dockerfile', 'args', 'target', 'cache_from', 'labels', 'network', 'shm_size'
        ],

        // Priority for logging keys
        loggingKeyPriority: [
            'driver', 'options'
        ],

        getSuggestions: function(text, cursorLine, cursorCol) {
            const lines = text.split('\n');
            const currentLine = lines[cursorLine - 1] || '';
            const beforeCursor = currentLine.slice(0, cursorCol);

            // Determine context
            const context = this.getContext(lines, cursorLine);
            const indent = currentLine.search(/\S/);
            const isAfterColon = beforeCursor.includes(':');
            const isStartOfKey = !isAfterColon && (indent === 0 || beforeCursor.trim() === '' || beforeCursor.trim().startsWith('-'));

            let suggestions = [];

            if (isStartOfKey || (!isAfterColon && beforeCursor.trim().length > 0)) {
                // Suggest keys
                suggestions = this.getKeySuggestions(context);
            } else if (isAfterColon) {
                // Suggest values
                const keyMatch = beforeCursor.match(/^\s*(\S+)\s*:/);
                if (keyMatch) {
                    suggestions = this.getValueSuggestions(context, keyMatch[1]);
                }
            }

            // Filter by what's already typed
            const typed = isAfterColon
                ? beforeCursor.split(':').pop().trim()
                : beforeCursor.trim().replace(/^-\s*/, '');

            if (typed) {
                const lower = typed.toLowerCase();
                suggestions = suggestions.filter(s =>
                    s.label.toLowerCase().startsWith(lower) ||
                    s.label.toLowerCase().includes(lower)
                );
                // Sort: startsWith matches first, then includes matches
                suggestions.sort((a, b) => {
                    const aStarts = a.label.toLowerCase().startsWith(lower);
                    const bStarts = b.label.toLowerCase().startsWith(lower);
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;
                    return 0;
                });
            }

            return suggestions.slice(0, 15);
        },

        getContext: function(lines, cursorLine) {
            const context = { path: [], indent: 0 };
            const indentStack = [{ indent: -1, key: 'root' }];

            // Only look at lines BEFORE the current line
            for (let i = 0; i < cursorLine - 1; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                if (trimmed === '' || trimmed.startsWith('#')) continue;

                const indent = line.search(/\S/);
                const keyMatch = trimmed.match(/^-?\s*([^:]+):/);

                if (keyMatch) {
                    const key = keyMatch[1].trim();
                    const afterColon = trimmed.slice(trimmed.indexOf(':') + 1).trim();

                    // Pop stack to find parent
                    while (indentStack.length > 1 && indentStack[indentStack.length - 1].indent >= indent) {
                        indentStack.pop();
                    }

                    // Only push to context if this key has nested content (empty value or block indicator)
                    // Keys with values like "image: nginx" are leaf nodes, not containers
                    const hasNestedContent = afterColon === '' ||
                                            afterColon === '|' ||
                                            afterColon === '>' ||
                                            afterColon === '|-' ||
                                            afterColon === '>-';

                    if (hasNestedContent) {
                        indentStack.push({ indent, key });
                    }
                }
            }

            // Check current line's indentation to determine proper context
            const currentLine = lines[cursorLine - 1] || '';
            let currentIndent = currentLine.search(/\S/);

            // For empty lines or lines with only whitespace, use the whitespace length as indent
            if (currentIndent < 0) {
                currentIndent = currentLine.length;
            }

            // Pop stack entries that are at same or higher indent than current position
            // This ensures we're at the right context level for the current indentation
            while (indentStack.length > 1 && indentStack[indentStack.length - 1].indent >= currentIndent) {
                indentStack.pop();
            }

            context.path = indentStack.slice(1).map(s => s.key);
            context.indent = indentStack.length > 0 ? indentStack[indentStack.length - 1].indent : -1;
            return context;
        },

        getKeySuggestions: function(context) {
            let schema = DockerComposeSchema;
            let priorityList = this.topLevelKeyPriority;

            // Determine context type for priority ordering
            const path = context.path;
            const lastKey = path[path.length - 1];

            if (path.length === 0) {
                priorityList = this.topLevelKeyPriority;
            } else if (path[0] === 'services' && path.length >= 2) {
                // Inside a service definition
                if (path.length === 2) {
                    // Directly inside service (services.myservice)
                    priorityList = this.serviceKeyPriority;
                } else if (lastKey === 'deploy') {
                    priorityList = this.deployKeyPriority;
                } else if (lastKey === 'healthcheck') {
                    priorityList = this.healthcheckKeyPriority;
                } else if (lastKey === 'resources') {
                    priorityList = this.resourcesKeyPriority;
                } else if (lastKey === 'placement') {
                    priorityList = this.placementKeyPriority;
                } else if (lastKey === 'update_config' || lastKey === 'rollback_config') {
                    priorityList = this.updateConfigKeyPriority;
                } else if (lastKey === 'restart_policy') {
                    priorityList = this.restartPolicyKeyPriority;
                } else if (lastKey === 'build') {
                    priorityList = this.buildKeyPriority;
                } else if (lastKey === 'logging') {
                    priorityList = this.loggingKeyPriority;
                } else if (lastKey === 'limits' || lastKey === 'reservations') {
                    priorityList = ['cpus', 'memory', 'pids', 'generic_resources'];
                } else {
                    priorityList = this.serviceKeyPriority;
                }
            } else if (path[0] === 'networks' && path.length >= 2) {
                priorityList = this.networkKeyPriority;
            } else if (path[0] === 'volumes' && path.length >= 2) {
                priorityList = this.volumeKeyPriority;
            } else if ((path[0] === 'secrets' || path[0] === 'configs') && path.length >= 2) {
                priorityList = this.secretKeyPriority;
            }

            // Navigate to correct schema level
            for (const key of path) {
                if (schema.children) {
                    schema = schema.children[key] || schema.children['*'];
                } else if (schema[key]) {
                    schema = schema[key];
                }
                if (!schema) break;
            }

            let keys = [];
            if (!schema) {
                // At top level
                keys = Object.keys(DockerComposeSchema).filter(k => k !== 'x');
                return this.sortByPriority(keys, priorityList).map(key => ({
                    label: key,
                    type: 'key',
                    description: DockerComposeSchema[key].description
                }));
            }

            if (schema.children) {
                keys = Object.keys(schema.children).filter(k => k !== '*');
                return this.sortByPriority(keys, priorityList).map(key => ({
                    label: key,
                    type: 'key',
                    description: schema.children[key].description
                }));
            }

            return [];
        },

        sortByPriority: function(keys, priorityList) {
            return keys.sort((a, b) => {
                const aIdx = priorityList.indexOf(a);
                const bIdx = priorityList.indexOf(b);
                // If both in priority list, sort by priority order
                if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
                // If only one in priority list, it comes first
                if (aIdx !== -1) return -1;
                if (bIdx !== -1) return 1;
                // Neither in list, sort alphabetically
                return a.localeCompare(b);
            });
        },

        getValueSuggestions: function(context, key) {
            let schema = DockerComposeSchema;

            for (const pathKey of context.path) {
                if (schema.children) {
                    schema = schema.children[pathKey] || schema.children['*'];
                } else if (schema[pathKey]) {
                    schema = schema[pathKey];
                }
                if (!schema) break;
            }

            if (schema && schema.children && schema.children[key]) {
                const keySchema = schema.children[key];
                if (keySchema.values) {
                    return keySchema.values.map(val => ({
                        label: val,
                        type: 'value',
                        description: `Valid value for ${key}`
                    }));
                }
            }

            return [];
        }
    };

    // ============================================
    // MAIN EDITOR CLASS
    // ============================================
    class DockerYamlEditor {
        constructor(container, options = {}) {
            this.container = typeof container === 'string'
                ? document.querySelector(container)
                : container;

            if (!this.container) {
                throw new Error('Container element not found');
            }

            this.options = {
                theme: options.theme || 'auto',
                initialValue: options.initialValue || '',
                tabSize: options.tabSize || 2,
                lineNumbers: options.lineNumbers !== false,
                ...options
            };

            this._value = this.options.initialValue;
            this._isValid = true;
            this._errors = [];
            this._parseErrors = [];
            this._listeners = { change: [], validate: [] };
            this._currentTooltip = null;
            this._autocompleteVisible = false;
            this._autocompleteItems = [];
            this._autocompleteIndex = 0;

            this._init();
        }

        _init() {
            this._createDOM();
            this._setupTheme();
            this._attachEventListeners();
            this._setValue(this._value, false);
            this._validate();
        }

        _createDOM() {
            this.container.classList.add('docker-yaml-editor');

            this.container.innerHTML = `
                <div class="dye-wrapper">
                    <div class="dye-gutter"></div>
                    <div class="dye-editor-area">
                        <div class="dye-highlight-layer"></div>
                        <textarea class="dye-textarea" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
                    </div>
                    <div class="dye-resize-handle"></div>
                </div>
            `;

            this._gutter = this.container.querySelector('.dye-gutter');
            this._highlightLayer = this.container.querySelector('.dye-highlight-layer');
            this._textarea = this.container.querySelector('.dye-textarea');
            this._resizeHandle = this.container.querySelector('.dye-resize-handle');
            this._wrapper = this.container.querySelector('.dye-wrapper');

            // Create tooltip in body to avoid clipping issues
            this._tooltip = document.createElement('div');
            this._tooltip.className = 'dye-tooltip';
            this._tooltip.style.display = 'none';
            document.body.appendChild(this._tooltip);

            // Create autocomplete in body to avoid clipping issues
            this._autocomplete = document.createElement('div');
            this._autocomplete.className = 'dye-autocomplete';
            this._autocomplete.style.display = 'none';
            document.body.appendChild(this._autocomplete);
        }

        _setupTheme() {
            if (this.options.theme === 'auto') {
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
                this._applyTheme(prefersDark.matches ? 'dark' : 'light');
                prefersDark.addEventListener('change', (e) => {
                    this._applyTheme(e.matches ? 'dark' : 'light');
                });
            } else {
                this._applyTheme(this.options.theme);
            }
        }

        _applyTheme(theme) {
            this.container.classList.remove('dye-theme-light', 'dye-theme-dark');
            this.container.classList.add(`dye-theme-${theme}`);
        }

        _attachEventListeners() {
            // Text input
            this._textarea.addEventListener('input', () => {
                this._handleInput();
            });

            this._textarea.addEventListener('scroll', () => {
                this._syncScroll();
            });

            this._textarea.addEventListener('keydown', (e) => {
                this._handleKeyDown(e);
            });

            // Hover for tooltips - listen on textarea since it's on top
            this._textarea.addEventListener('mousemove', (e) => {
                this._handleMouseMove(e);
            });

            this._textarea.addEventListener('mouseleave', () => {
                this._hideTooltip();
            });

            // Resize
            this._setupResize();

            // Handle window resize
            window.addEventListener('resize', () => {
                this._updateLayout();
            });

            // Click to hide autocomplete
            document.addEventListener('click', (e) => {
                if (!this.container.contains(e.target)) {
                    this._hideAutocomplete();
                }
            });
        }

        _setupResize() {
            let startY, startHeight;

            const onMouseMove = (e) => {
                const newHeight = startHeight + (e.clientY - startY);
                if (newHeight >= 100) {
                    this._wrapper.style.height = newHeight + 'px';
                    this._updateLayout();
                }
            };

            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this._wrapper.classList.remove('dye-resizing');
            };

            this._resizeHandle.addEventListener('mousedown', (e) => {
                startY = e.clientY;
                startHeight = this._wrapper.offsetHeight;
                this._wrapper.classList.add('dye-resizing');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
                e.preventDefault();
            });
        }

        _handleInput() {
            this._value = this._textarea.value;
            this._updateHighlighting();
            this._updateGutter();
            this._validate();
            this._emit('change', { value: this._value, isValid: this._isValid });
        }

        _handleKeyDown(e) {
            // Handle Tab
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this._textarea.selectionStart;
                const end = this._textarea.selectionEnd;
                const spaces = ' '.repeat(this.options.tabSize);

                if (e.shiftKey) {
                    // Unindent
                    const lines = this._value.split('\n');
                    const lineStart = this._value.lastIndexOf('\n', start - 1) + 1;
                    const lineEnd = this._value.indexOf('\n', start);
                    const currentLine = lines[this._value.slice(0, start).split('\n').length - 1];

                    if (currentLine.startsWith(spaces)) {
                        this._textarea.value = this._value.slice(0, lineStart) + currentLine.slice(this.options.tabSize) + this._value.slice(lineEnd === -1 ? this._value.length : lineEnd);
                        this._textarea.selectionStart = this._textarea.selectionEnd = start - this.options.tabSize;
                        this._handleInput();
                    }
                } else {
                    // Indent
                    this._textarea.value = this._value.slice(0, start) + spaces + this._value.slice(end);
                    this._textarea.selectionStart = this._textarea.selectionEnd = start + this.options.tabSize;
                    this._handleInput();
                }
                return;
            }

            // Handle autocomplete navigation
            if (this._autocompleteVisible) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this._autocompleteIndex = Math.min(this._autocompleteIndex + 1, this._autocompleteItems.length - 1);
                    this._renderAutocomplete();
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this._autocompleteIndex = Math.max(this._autocompleteIndex - 1, 0);
                    this._renderAutocomplete();
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    if (this._autocompleteItems.length > 0) {
                        e.preventDefault();
                        this._acceptAutocomplete(this._autocompleteItems[this._autocompleteIndex]);
                        return;
                    }
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this._hideAutocomplete();
                    return;
                }
            }

            // Trigger autocomplete on Ctrl+Space
            if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault();
                this._showAutocomplete();
                return;
            }

            // Auto-trigger autocomplete while typing
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                setTimeout(() => this._showAutocomplete(), 10);
            }

            // Handle Enter - maintain indentation
            if (e.key === 'Enter' && !this._autocompleteVisible) {
                const start = this._textarea.selectionStart;
                const lineStart = this._value.lastIndexOf('\n', start - 1) + 1;
                const currentLine = this._value.slice(lineStart, start);
                const indent = currentLine.match(/^\s*/)[0];

                // Add extra indent after :
                const extraIndent = currentLine.trim().endsWith(':') ? '  ' : '';

                e.preventDefault();
                this._textarea.value = this._value.slice(0, start) + '\n' + indent + extraIndent + this._value.slice(start);
                this._textarea.selectionStart = this._textarea.selectionEnd = start + 1 + indent.length + extraIndent.length;
                this._handleInput();
            }
        }

        _showAutocomplete() {
            const pos = this._textarea.selectionStart;
            const lines = this._value.slice(0, pos).split('\n');
            const line = lines.length;
            const col = lines[lines.length - 1].length;

            const suggestions = AutocompleteEngine.getSuggestions(this._value, line, col);

            if (suggestions.length === 0) {
                this._hideAutocomplete();
                return;
            }

            this._autocompleteItems = suggestions;
            this._autocompleteIndex = 0;
            this._autocompleteVisible = true;
            this._renderAutocomplete();
            this._positionAutocomplete();
        }

        _renderAutocomplete() {
            // Apply theme class (autocomplete is in body, not container)
            this._autocomplete.className = 'dye-autocomplete ' +
                (this.container.classList.contains('dye-theme-dark') ? 'dye-theme-dark' : 'dye-theme-light');

            this._autocomplete.innerHTML = this._autocompleteItems.map((item, idx) => `
                <div class="dye-autocomplete-item ${idx === this._autocompleteIndex ? 'selected' : ''}" data-index="${idx}">
                    <span class="dye-ac-label">${this._escapeHtml(item.label)}</span>
                    <span class="dye-ac-type">${item.type}</span>
                </div>
            `).join('');

            this._autocomplete.style.display = 'block';

            // Add click handlers
            this._autocomplete.querySelectorAll('.dye-autocomplete-item').forEach(el => {
                el.addEventListener('click', () => {
                    this._acceptAutocomplete(this._autocompleteItems[parseInt(el.dataset.index)]);
                });
            });

            // Scroll selected item into view within the autocomplete container
            this._scrollSelectedIntoView();
        }

        _scrollSelectedIntoView() {
            const container = this._autocomplete;
            const selectedItem = container.querySelector('.dye-autocomplete-item.selected');
            if (!selectedItem) return;

            const containerRect = container.getBoundingClientRect();
            const itemRect = selectedItem.getBoundingClientRect();

            // Check if item is above visible area
            if (itemRect.top < containerRect.top) {
                container.scrollTop -= (containerRect.top - itemRect.top);
            }
            // Check if item is below visible area
            else if (itemRect.bottom > containerRect.bottom) {
                container.scrollTop += (itemRect.bottom - containerRect.bottom);
            }
        }

        _positionAutocomplete() {
            const pos = this._textarea.selectionStart;
            const lines = this._value.slice(0, pos).split('\n');
            const lineNum = lines.length;
            const col = lines[lines.length - 1].length;

            const lineHeight = 20;
            const charWidth = 8.4;
            const padding = 8;

            // Get textarea position in viewport
            const textareaRect = this._textarea.getBoundingClientRect();

            // Calculate position relative to viewport
            let top = textareaRect.top + padding + (lineNum * lineHeight) - this._textarea.scrollTop;
            let left = textareaRect.left + padding + (col * charWidth) - this._textarea.scrollLeft;

            // Get autocomplete dimensions
            const acRect = this._autocomplete.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // If autocomplete would go below viewport, show it above the cursor
            if (top + acRect.height > viewportHeight - 10) {
                top = top - acRect.height - lineHeight;
            }

            // Keep within horizontal bounds
            if (left + acRect.width > viewportWidth - 10) {
                left = viewportWidth - acRect.width - 10;
            }
            if (left < 10) left = 10;
            if (top < 10) top = 10;

            this._autocomplete.style.top = top + 'px';
            this._autocomplete.style.left = left + 'px';
        }

        _acceptAutocomplete(item) {
            const pos = this._textarea.selectionStart;
            const beforeCursor = this._value.slice(0, pos);
            const afterCursor = this._value.slice(pos);

            // Find what's already typed
            const match = beforeCursor.match(/[a-zA-Z_\-\.0-9]*$/);
            const typed = match ? match[0] : '';
            const insertStart = pos - typed.length;

            let insertText = item.label;
            if (item.type === 'key') {
                insertText += ': ';
            }

            this._textarea.value = this._value.slice(0, insertStart) + insertText + afterCursor;
            this._textarea.selectionStart = this._textarea.selectionEnd = insertStart + insertText.length;
            this._handleInput();
            this._hideAutocomplete();
            this._textarea.focus();
        }

        _hideAutocomplete() {
            this._autocomplete.style.display = 'none';
            this._autocompleteVisible = false;
        }

        _handleMouseMove(e) {
            const rect = this._textarea.getBoundingClientRect();
            // Account for padding (8px default)
            const padding = 8;
            const x = e.clientX - rect.left - padding + this._textarea.scrollLeft;
            const y = e.clientY - rect.top - padding + this._textarea.scrollTop;

            const lineHeight = 20;
            const charWidth = 8.4;

            const line = Math.floor(y / lineHeight) + 1;
            const col = Math.floor(x / charWidth);

            // Check for errors on this line
            const error = this._errors.find(err => err.line === line);
            const parseError = this._parseErrors.find(err => err.line === line);

            if (error || parseError) {
                const err = error || parseError;
                let content = `<div class="dye-tooltip-error">${this._escapeHtml(err.message)}</div>`;
                if (err.validValues) {
                    content += `<div class="dye-tooltip-values">Valid values: ${err.validValues.slice(0, 10).join(', ')}${err.validValues.length > 10 ? '...' : ''}</div>`;
                }
                if (err.validKeys) {
                    content += `<div class="dye-tooltip-keys">Valid keys: ${err.validKeys.slice(0, 10).join(', ')}${err.validKeys.length > 10 ? '...' : ''}</div>`;
                }
                this._showTooltip(content, e.clientX, e.clientY);
                return;
            }

            // Check for key documentation
            const lines = this._value.split('\n');
            if (line <= lines.length) {
                const lineText = lines[line - 1];
                const keyMatch = lineText.match(/^\s*-?\s*([a-zA-Z_][a-zA-Z0-9_\-\.]*)\s*:/);
                if (keyMatch) {
                    const key = keyMatch[1];
                    const keyStart = lineText.indexOf(key);
                    const keyEnd = keyStart + key.length;

                    if (col >= keyStart && col <= keyEnd) {
                        const doc = this._getKeyDocumentation(line, key);
                        if (doc) {
                            this._showTooltip(doc, e.clientX, e.clientY);
                            return;
                        }
                    }
                }
            }

            this._hideTooltip();
        }

        _getKeyDocumentation(line, key) {
            const lines = this._value.split('\n');
            const context = AutocompleteEngine.getContext(lines, line);

            let schema = DockerComposeSchema;

            // Navigate to current context
            for (const pathKey of context.path) {
                if (schema.children) {
                    schema = schema.children[pathKey] || schema.children['*'];
                } else if (schema[pathKey]) {
                    schema = schema[pathKey];
                }
                if (!schema) break;
            }

            // Find key in schema
            let keySchema = null;
            if (schema && schema.children) {
                keySchema = schema.children[key] || (schema.children['*'] ? schema.children['*'].children?.[key] : null);
            } else if (DockerComposeSchema[key]) {
                keySchema = DockerComposeSchema[key];
            }

            if (!keySchema) return null;

            let html = `<div class="dye-tooltip-title">${this._escapeHtml(key)}</div>`;
            html += `<div class="dye-tooltip-desc">${this._escapeHtml(keySchema.description || '')}</div>`;

            if (keySchema.type) {
                const typeStr = Array.isArray(keySchema.type) ? keySchema.type.join(' | ') : keySchema.type;
                html += `<div class="dye-tooltip-type">Type: ${typeStr}</div>`;
            }

            if (keySchema.values) {
                html += `<div class="dye-tooltip-values">Values: ${keySchema.values.slice(0, 8).join(', ')}${keySchema.values.length > 8 ? '...' : ''}</div>`;
            }

            if (keySchema.example) {
                html += `<div class="dye-tooltip-example">Example: ${this._escapeHtml(keySchema.example)}</div>`;
            }

            return html;
        }

        _showTooltip(content, x, y) {
            // Apply theme class to tooltip (it's in body, not container)
            this._tooltip.className = 'dye-tooltip ' +
                (this.container.classList.contains('dye-theme-dark') ? 'dye-theme-dark' : 'dye-theme-light');
            this._tooltip.innerHTML = content;
            this._tooltip.style.display = 'block';

            // Position tooltip relative to viewport (tooltip is in body)
            let left = x + 10;
            let top = y + 15;

            // Keep tooltip in viewport bounds
            const tooltipRect = this._tooltip.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            if (left + tooltipRect.width > viewportWidth - 10) {
                left = x - tooltipRect.width - 10;
            }
            if (top + tooltipRect.height > viewportHeight - 10) {
                top = y - tooltipRect.height - 10;
            }
            if (left < 10) left = 10;
            if (top < 10) top = 10;

            this._tooltip.style.left = left + 'px';
            this._tooltip.style.top = top + 'px';
        }

        _hideTooltip() {
            this._tooltip.style.display = 'none';
        }

        _updateHighlighting() {
            const tokens = YamlTokenizer.tokenize(this._value);
            let html = '';

            for (let i = 0; i < tokens.length; i++) {
                const lineTokens = tokens[i];
                const lineNum = i + 1;
                const hasError = this._errors.some(e => e.line === lineNum) ||
                                 this._parseErrors.some(e => e.line === lineNum);

                html += `<div class="dye-line ${hasError ? 'dye-line-error' : ''}">`;

                for (const token of lineTokens) {
                    html += `<span class="dye-token dye-${token.type}">${this._escapeHtml(token.value)}</span>`;
                    if (token.comment) {
                        html += `<span class="dye-token dye-comment">${this._escapeHtml(token.comment.value)}</span>`;
                    }
                }

                html += '</div>';
            }

            this._highlightLayer.innerHTML = html;
        }

        _updateGutter() {
            const lines = this._value.split('\n');
            let html = '';

            for (let i = 1; i <= lines.length; i++) {
                const hasError = this._errors.some(e => e.line === i) ||
                                 this._parseErrors.some(e => e.line === i);
                html += `<div class="dye-gutter-line ${hasError ? 'dye-gutter-error' : ''}">${i}</div>`;
            }

            this._gutter.innerHTML = html;
        }

        _syncScroll() {
            this._highlightLayer.scrollTop = this._textarea.scrollTop;
            this._highlightLayer.scrollLeft = this._textarea.scrollLeft;
            this._gutter.scrollTop = this._textarea.scrollTop;
        }

        _updateLayout() {
            this._syncScroll();
        }

        _validate() {
            // Parse YAML
            const parseResult = YamlParser.parse(this._value);
            this._parseErrors = parseResult.errors;

            // Validate against Docker Compose schema
            this._errors = DockerComposeValidator.validate(this._value, parseResult.data);

            // Combine errors
            const allErrors = [...this._parseErrors, ...this._errors];
            this._isValid = allErrors.filter(e => e.severity === 'error' || !e.severity).length === 0;

            // Update UI
            this._updateHighlighting();
            this._updateGutter();

            this._emit('validate', { isValid: this._isValid, errors: allErrors });
        }

        _setValue(value, triggerEvents = true) {
            this._value = value;
            this._textarea.value = value;
            this._updateHighlighting();
            this._updateGutter();
            this._validate();

            if (triggerEvents) {
                this._emit('change', { value: this._value, isValid: this._isValid });
            }
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        _emit(event, data) {
            if (this._listeners[event]) {
                this._listeners[event].forEach(cb => cb(data));
            }
        }

        // Public API
        get isValid() {
            return this._isValid;
        }

        getValue() {
            return this._value;
        }

        setValue(value) {
            this._setValue(value);
        }

        getErrors() {
            return [...this._parseErrors, ...this._errors];
        }

        on(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event].push(callback);
            }
            return () => {
                this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            };
        }

        setTheme(theme) {
            if (theme === 'auto') {
                this._setupTheme();
            } else {
                this._applyTheme(theme);
            }
        }

        focus() {
            this._textarea.focus();
        }

        destroy() {
            this._listeners = { change: [], validate: [] };
            // Remove tooltip from body
            if (this._tooltip && this._tooltip.parentNode) {
                this._tooltip.parentNode.removeChild(this._tooltip);
            }
            // Remove autocomplete from body
            if (this._autocomplete && this._autocomplete.parentNode) {
                this._autocomplete.parentNode.removeChild(this._autocomplete);
            }
            this.container.innerHTML = '';
            this.container.classList.remove('docker-yaml-editor', 'dye-theme-light', 'dye-theme-dark');
        }
    }

    // Static init method
    DockerYamlEditor.init = function(container, options) {
        return new DockerYamlEditor(container, options);
    };

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DockerYamlEditor;
    } else {
        global.DockerYamlEditor = DockerYamlEditor;
    }

})(typeof window !== 'undefined' ? window : this);
